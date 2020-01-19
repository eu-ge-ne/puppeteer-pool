import { EventEmitter } from "events";

import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import { LockAsync } from "@eu-ge-ne/lock-async";
import dbg from "debug";

const debug = dbg("PuppeteerPool");

const dbgItem = (x: Item) => ({ id: x.id, counter: x.counter, active: x.pages.length });

const ACQUIRE_TIMEOUT_DEFAULT = 30_000;

export type Options = {
    launch?: () => Promise<Browser>;
    /** LaunchOptions for puppeteer */
    launchOptions?: LaunchOptions;
    /** Maximum time in milliseconds to wait for acquire. Defaults to 30000 */
    acquireTimeout?: number;
    /** Concurrency of the pool */
    concurrency: number;
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
    /** Emitted after page acquired */
    after_acquire: (page: Page, opt: P) => void;
    /** Emitted after page destroyed */
    after_destroy: (page: Page) => void;
};

export declare interface PuppeteerPool<P> {
    on<E extends keyof Events<P>>(event: E, listener: Events<P>[E]): this;
    emit<E extends keyof Events<P>>(event: E, ...args: Parameters<Events<P>[E]>): boolean;
}

export class PuppeteerPool<P = void> extends EventEmitter {
    private readonly lock = new LockAsync(10_000);

    private items: Item[] = [];
    private nextItemId = 1;

    public constructor(private readonly options: Options) {
        super();

        if (this.options.concurrency < 1) {
            throw new Error("Concurrency option must be provided (>= 1)");
        }
    }

    public async acquire(pageOpts: P): Promise<Page> {
        let result: Page | null = null;

        const acquireTimeout = this.options.acquireTimeout ?? ACQUIRE_TIMEOUT_DEFAULT
        const waitUntil = Date.now() + acquireTimeout;

        do {
            result = await this.lock.run(async () => {
                if (this.totalActive >= this.options.concurrency) {
                    return null;
                }

                let item = this.items.find(x => x.counter < this.options.concurrency);

                if (item) {
                    const page = await item.browser.newPage();
                    item.pages.push(page);
                    item.counter += 1;
                    debug("acquire: existing browser; %o", dbgItem(item));
                    return page;
                } else {
                    const browser = this.options.launch
                        ? await this.options.launch()
                        : await launch(this.options.launchOptions);
                    try {
                        item = {
                            id: this.nextItemId++,
                            created: Date.now(),
                            browser,
                            counter: 1,
                            pages: [await browser.newPage()],
                        };
                    } catch (err) {
                        await browser.close();
                        throw err;
                    }
                    this.items.push(item);
                    debug("acquire: new browser; %o", dbgItem(item));
                    return item.pages[0];
                }
            });

            if (!result) {
                await new Promise(x => setTimeout(x, 1_000));
            }
        } while (!result && (waitUntil - Date.now() > 0));

        if (!result) {
            throw new Error(`Acquire timeout: ${acquireTimeout} ms`);
        }

        this.emit("after_acquire", result, pageOpts);

        return result;
    }

    public async destroy(page: Page): Promise<void> {
        await this.lock.run(async () => {
            const itemIndex = this.items.findIndex(item => item.pages.findIndex(x => x === page) >= 0);
            if (itemIndex < 0) {
                throw new Error("Provided page does not belong to the pool");
            }

            const item = this.items[itemIndex];
            const pageIndex = item.pages.findIndex(x => x === page);

            await page.close();
            item.pages.splice(pageIndex, 1);

            if ((item.pages.length > 0) || (item.counter < this.options.concurrency)) {
                debug("destroy: page closed; %o", dbgItem(item));
            } else {
                await item.browser.close();
                this.items.splice(itemIndex, 1);
                debug("destroy: last page and browser closed; %o", dbgItem(item));
            }
        });

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

    private get totalActive(): number {
        const count = this.items.reduce((sum, item) => sum + item.pages.length, 0);
        debug("totalActive: %d", count);
        return count;
    }
}
