import { EventEmitter } from "events";

import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import { LockAsync } from "@eu-ge-ne/lock-async";
import dbg from "debug";

const debug = dbg("PuppeteerPool");

const dbgItem = (x: BrowserItem) => ({ id: x.id, counter: x.counter, active: x.pages.length });

const CONCURRENCY_DEFAULT = 1;
const ACQUIRE_TIMEOUT_DEFAULT = 45_000;

export type Options = {
    /**
     * Concurrency of the pool
     * Defaults to 1
     */
    concurrency?: number;

    /**
     * Maximum time in milliseconds to wait for acquire
     * Defaults to 45_000
     * Should be greater than launchOptions.timeout
     */
    acquireTimeout?: number;

    /**
     * Options, provided to default puppeteer.launch()
     */
    launchOptions?: LaunchOptions;

    /**
     * Custom function, used instead of default puppeteer.launch()
     * launchOptions are ignored in this case
     * Must call puppeteer.launch() and return its result
     */
    launch?: () => Promise<Browser>;
};

export type Status = Array<{
    lifetime: number;
    counter: number;
    active: number;
}>;

type PageItem = [Promise<Page>, Page | null];

type BrowserItem = {
    id: number;
    created: number;
    browser: Browser;
    pages: PageItem[];
    counter: number;
};

type Events<P> = {
    /**
     * Emitted after page acquired
     */
    after_acquire: (page: Page, opt: P) => void;
    /**
     * Emitted after page destroyed
     */
    after_destroy: (page: Page) => void;
    /**
     * Emitted when error occurred
     */
    error: (err: Error) => void;
};

export declare interface PuppeteerPool<P> {
    on<E extends keyof Events<P>>(event: E, listener: Events<P>[E]): this;
    emit<E extends keyof Events<P>>(event: E, ...args: Parameters<Events<P>[E]>): boolean;
}

export class PuppeteerPool<P = void> extends EventEmitter {
    private readonly lock: LockAsync;

    private browsers: BrowserItem[] = [];
    private nextItemId = 1;
    private closeUsedTimeout!: NodeJS.Timeout;
    private usedBrowsers: Browser[] = [];
    private usedPages: Page[] = [];

    public constructor(private readonly options: Options) {
        super();
        debug("constructor: concurrency %d; acquireTimeout %d", this.concurrency, this.acquireTimeout);
        this.lock = new LockAsync(this.acquireTimeout);
    }

    public async acquire(pageOpts: P): Promise<Page> {
        let result: PageItem | null = null;

        const waitUntil = Date.now() + this.acquireTimeout;

        do {
            try {
                result = await this.tryAcquire();
            } catch (err) {
                debug("acquire: error %o", err);
            }
            if (!result) {
                await new Promise(x => setTimeout(x, 1_000));
            }
        } while (!result && (waitUntil - Date.now() > 0));

        if (!result) {
            throw new Error(`Acquire timeout: ${this.acquireTimeout} ms`);
        }

        try {
            const page = result[1] = await result[0];
            this.emit("after_acquire", page, pageOpts);
            return page;
        } catch (err) {
            const pagePromise = result[0];
            await this.destroyAndClose(x => x[0] === pagePromise);
            throw err;
        }
    }

    public async destroy(page: Page): Promise<void> {
        return await this.destroyAndClose(x => x[1] === page);
    }

    public async stop() {
        debug("stop: stopping");

        clearTimeout(this.closeUsedTimeout);

        return await this.lock.run(async () => {
            for (const browserItem of this.browsers) {
                try {
                    await browserItem.browser.close();
                } catch (err) {
                    this.emit("error", err);
                }
            }
            this.browsers = [];
            debug("stop: stopped");
        });
    }

    public status(): Status {
        return this.browsers.map(x => ({
            lifetime: Date.now() - x.created,
            counter: x.counter,
            active: x.pages.length,
        }));
    }

    private get concurrency(): number {
        return Math.max(CONCURRENCY_DEFAULT, this.options?.concurrency ?? 0);
    }

    private get acquireTimeout(): number {
        return Math.max(ACQUIRE_TIMEOUT_DEFAULT, this.options?.acquireTimeout ?? 0);
    }

    private async tryAcquire(): Promise<PageItem | null> {
        return await this.lock.run(async () => {
            const totalActive = this.browsers.reduce((sum, item) => sum + item.pages.length, 0);

            if (totalActive >= this.concurrency) {
                return null;
            }

            let browserItem = this.browsers.find(x => x.counter < this.concurrency);

            if (browserItem) {
                const pageItem: PageItem = [browserItem.browser.newPage(), null];
                browserItem.pages.push(pageItem);
                browserItem.counter += 1;
                debug("tryAcquire: existing browser; %o", dbgItem(browserItem));
                return pageItem;
            } else {
                const browser = this.options.launch
                    ? await this.options.launch()
                    : await launch(this.options.launchOptions);
                try {
                    const pageItem: PageItem = [browser.newPage(), null];
                    browserItem = {
                        id: this.nextItemId++,
                        created: Date.now(),
                        browser,
                        counter: 1,
                        pages: [pageItem],
                    };
                } catch (err) {
                    await browser.close();
                    throw err;
                }
                this.browsers.push(browserItem);
                debug("tryAcquire: new browser; %o", dbgItem(browserItem));
                return browserItem.pages[0];
            }
        });
    }

    private async destroyAndClose(find: (x: PageItem) => boolean): Promise<void> {
        await this.lock.run(async () => {
            const browserIndex = this.browsers.findIndex(item => item.pages.findIndex(find) >= 0);
            if (browserIndex < 0) {
                throw new Error("Provided page does not belong to the pool");
            }

            const browserItem = this.browsers[browserIndex];
            const pageIndex = browserItem.pages.findIndex(find);
            const pageItem = browserItem.pages[pageIndex];
            browserItem.pages.splice(pageIndex, 1);

            if ((browserItem.pages.length > 0) || (browserItem.counter < this.concurrency)) {
                debug("destroy: closing page; %o", dbgItem(browserItem));
                if (pageItem[1]) {
                    this.usedPages.push(pageItem[1]);
                }
            } else {
                this.browsers.splice(browserIndex, 1);
                debug("destroy: closing last page and browser; %o", dbgItem(browserItem));
                this.usedBrowsers.push(browserItem.browser);
            }

            await this.closeUsed();
        });
    }

    private async closeUsed() {
        clearTimeout(this.closeUsedTimeout);

        this.closeUsedTimeout = setTimeout(async () => {
            const usedPages = this.usedPages;
            const usedBrowsers = this.usedBrowsers;

            this.usedPages = [];
            this.usedBrowsers = [];

            for (const page of usedPages) {
                try {
                    await page.close();
                    this.emit("after_destroy", page);
                } catch (err) {
                    this.emit("error", err);
                }
            }

            for (const browser of usedBrowsers) {
                try {
                    await browser.close();
                } catch (err) {
                    this.emit("error", err);
                }
            }
        }, 100);
    }
}
