import { EventEmitter } from "events";

import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import dbg from "debug";

import { AcquireQueue, AcquireStats } from "./acquireQueue";
import { CloseQueue } from "./closeQueue";
import { PoolItem } from "./poolItem";
import { AsyncSerial } from "./asyncSerial";

const CONCURRENCY_DEFAULT = 1;
const ACQUIRE_TIMEOUT_DEFAULT = 30_000;

dbg.formatters.x = (poolItem: PoolItem) => poolItem.debug();

const debug = dbg("PuppeteerPool");

export type Options = {
    /**
     * Concurrency of the pool
     * Defaults to 1
     */
    concurrency?: number;
    /**
     * Maximum time in milliseconds to wait for acquire
     * Defaults to 30_000
     * Should be equal or greater than launchOptions.timeout
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

export type PoolStats = {
    browsers: {
        lifetime: number;
        counter: number;
        active: number;
    }[];
    acquireTime: AcquireStats;
};

type Events<P> = {
    /**
     * Emitted after page acquired
     */
    after_acquire: (page: Page, opt: P) => void;
    /**
     * Emitted after page closed
     */
    after_close: (page: Page) => void;
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
    private acquireQueue: AcquireQueue<P>;
    private closeQueue: CloseQueue;
    private asyncSerial: AsyncSerial;
    private pool: PoolItem[] = [];

    constructor(private readonly options: Options) {
        super();

        debug("concurrency %d; acquireTimeout %d", this.concurrency, this.acquireTimeout);

        this.acquireQueue = new AcquireQueue<P>(this, this.acquireTimeout);

        this.closeQueue = new CloseQueue(this);
        this.asyncSerial = new AsyncSerial(this);
    }

    async acquire(pageOpts: P): Promise<Page> {
        return new Promise<Page>((resolve, reject) => {
            this.acquireQueue.add(resolve, reject, pageOpts);
            this.asyncSerial.run(() => this.processQueues());
        });
    }

    close(page: Page) {
        const poolItemIndex = this.pool.findIndex(item => item.findPageIndex(page) >= 0);
        if (poolItemIndex < 0) {
            throw new Error("Provided page does not belong to the pool");
        }

        const poolItem = this.pool[poolItemIndex];

        poolItem.removePage(page);

        this.closeQueue.addPage(page);

        if ((poolItem.active > 0) || !poolItem.isExhausted) {
            debug("close: closing page; %x", poolItem);
        } else {
            this.pool.splice(poolItemIndex, 1);
            debug("close: closing last page and browser; %x", poolItem);
            this.closeQueue.addBrowser(poolItem.browser);
        }

        this.asyncSerial.run(() => this.processQueues());
    }

    closeAll() {
        for (const poolItem of this.pool) {
            this.closeQueue.addPage(...poolItem.removeAllPages());
            this.closeQueue.addBrowser(poolItem.browser);
        }
        this.pool = [];
        this.asyncSerial.run(() => this.processQueues());
    }

    stats(): PoolStats {
        return {
            browsers: this.pool.map(x => x.stats()),
            acquireTime: this.acquireQueue.stats(),
        };
    }

    private get concurrency(): number {
        return Math.max(CONCURRENCY_DEFAULT, this.options?.concurrency ?? 0);
    }

    private get acquireTimeout(): number {
        return Math.max(0, this.options?.acquireTimeout ?? ACQUIRE_TIMEOUT_DEFAULT);
    }

    private get totalActive(): number {
        return this.pool.reduce((sum, poolItem) => sum + poolItem.active, 0);
    }

    private async processQueues() {
        await this.closeQueue.closeAll();

        while (!this.acquireQueue.isEmpty && (this.totalActive < this.concurrency)) {
            let page: Page;

            let poolItem = this.pool.find(x => !x.isExhausted);

            if (!poolItem) {
                const browser = this.options.launch
                    ? await this.options.launch()
                    : await launch(this.options.launchOptions);

                try {
                    page = await browser.newPage();
                } catch (err) {
                    await browser.close();
                    throw err;
                }

                poolItem = new PoolItem(this.concurrency, browser);
                poolItem.addPage(page);
                this.pool.push(poolItem);

                debug("processQueues: new browser; %x", poolItem);
            } else {
                page = await poolItem.browser.newPage();

                poolItem.addPage(page);

                debug("processQueues: existing browser; %x", poolItem);
            }

            this.acquireQueue.resolve(page);
        }
    }
}
