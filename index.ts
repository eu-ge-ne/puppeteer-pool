import { EventEmitter } from "events";

import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import { LockAsync } from "@eu-ge-ne/lock-async";
import dbg from "debug";

const debug = dbg("PuppeteerPool");

const dbgItem = (x: Item) => ({ id: x.id, counter: x.counter, active: x.pages.length });

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

type Item = {
    id: number;
    created: number;
    browser: Browser;
    pages: Page[];
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

    private items: Item[] = [];
    private nextItemId = 1;

    public constructor(private readonly options: Options) {
        super();
        debug("constructor: concurrency %d; acquireTimeout %d", this.concurrency, this.acquireTimeout);
        this.lock = new LockAsync(this.acquireTimeout);
    }

    public async acquire(pageOpts: P): Promise<Page> {
        let result: Page | null = null;

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

        this.emit("after_acquire", result, pageOpts);

        return result;
    }

    public async destroy(page: Page): Promise<void> {
        const closable = await this.lock.run(async () => {
            const itemIndex = this.items.findIndex(item => item.pages.findIndex(x => x === page) >= 0);
            if (itemIndex < 0) {
                throw new Error("Provided page does not belong to the pool");
            }

            const item = this.items[itemIndex];
            const pageIndex = item.pages.findIndex(x => x === page);
            item.pages.splice(pageIndex, 1);

            if ((item.pages.length > 0) || (item.counter < this.concurrency)) {
                debug("destroy: closing page; %o", dbgItem(item));
                return page;
            } else {
                this.items.splice(itemIndex, 1);
                debug("destroy: closing last page and browser; %o", dbgItem(item));
                return item.browser;
            }
        });

        try {
            await closable.close();
        } catch (err) {
            this.emit("error", err);
        }

        this.emit("after_destroy", page);
    }

    public async stop() {
        debug("stop: stopping");
        return await this.lock.run(async () => {
            for (const item of this.items) {
                for (const page of item.pages) {
                    await page.close();
                }
                await item.browser.close();
            }
            this.items = [];
            debug("stop: stopped");
        });
    }

    public status(): Status {
        return this.items.map(x => ({
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

    private get totalActive(): number {
        return this.items.reduce((sum, item) => sum + item.pages.length, 0);
    }

    private async tryAcquire(): Promise<Page | null> {
        return await this.lock.run(async () => {
            if (this.totalActive >= this.concurrency) {
                return null;
            }

            let item = this.items.find(x => x.counter < this.concurrency);

            if (item) {
                const page = await item.browser.newPage();
                item.pages.push(page);
                item.counter += 1;
                debug("tryAcquire: existing browser; %o", dbgItem(item));
                return page;
            } else {
                const browser = this.options.launch
                    ? await this.options.launch()
                    : await launch(this.options.launchOptions);
                try {
                    const page = await browser.newPage();
                    item = {
                        id: this.nextItemId++,
                        created: Date.now(),
                        browser,
                        counter: 1,
                        pages: [page],
                    };
                } catch (err) {
                    await browser.close();
                    throw err;
                }
                this.items.push(item);
                debug("tryAcquire: new browser; %o", dbgItem(item));
                return item.pages[0];
            }
        });
    }
}
