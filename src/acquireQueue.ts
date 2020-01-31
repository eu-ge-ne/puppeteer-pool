import { Page } from "puppeteer";

export type AcquireStats = {
    max: number;
    mean: number;
};

type AcquireItem<P> = {
    started: number;
    resolve: (page: Page) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
    pageOpts: P;
};

type Emitter<P> = {
    emit(event: "after_acquire", page: Page, opt: P): boolean;
}

export class AcquireQueue<P> {
    private queue: AcquireItem<P>[] = [];
    private count = 0;
    private timeMax = 0;
    private timeTotal = 0;

    constructor(private emitter: Emitter<P>, private acquireTimeout: number) {
    }

    get isEmpty() {
        return this.queue.length === 0;
    }

    add(resolve: (page: Page) => void, reject: (err: Error) => void, pageOpts: P) {
        const item: AcquireItem<P> = {
            started: Date.now(),
            resolve,
            reject,
            timeout: setTimeout(() => {
                const i = this.queue.findIndex(x => x === item);
                if (i >= 0) {
                    this.queue.splice(i, 1);
                }
                reject(new Error(`Acquire timeout: ${this.acquireTimeout} ms`));
                this.addStats(item.started);
            }, this.acquireTimeout),
            pageOpts,
        };

        this.queue.push(item);
    }

    resolve(page: Page) {
        const item = this.queue.shift();
        if (item) {
            clearTimeout(item.timeout);
            item.resolve(page);
            this.emitter.emit("after_acquire", page, item.pageOpts);
            this.addStats(item.started);
        }
    }

    stats(): AcquireStats {
        return {
            max: this.timeMax,
            mean: Math.round(this.timeTotal / this.count),
        };
    }

    private addStats(started: number) {
        this.count += 1;
        const time = Date.now() - started;
        this.timeMax = Math.max(this.timeMax, time);
        this.timeTotal += time;
    }
}
