import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import { LockAsync } from "@eu-ge-ne/lock-async";
import dbg from "debug";

const debug = dbg("PuppeteerPool");

export type Options = {
    launch?: () => Promise<Browser>;
    launchOptions?: LaunchOptions;
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

export class PuppeteerPool {
    private readonly lock = new LockAsync(10_000);

    private items: Item[] = [];
    private nextItemId = 1;

    public constructor(private readonly options: Options) {
        if (this.options.concurrency < 1) {
            throw new Error("Concurrency option must be provided (>= 1)");
        }
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

    public async acquire(): Promise<Page> {
        return await this.lock.run(async () => {
            let item = this.items.find(x => x.counter < this.options.concurrency);

            if (!item) {
                const browser = this.options.launch
                    ? await this.options.launch()
                    : await launch(this.options.launchOptions);

                item = {
                    id: this.nextItemId++,
                    created: Date.now(),
                    browser,
                    counter: 1,
                    pages: [await browser.newPage()],
                };

                this.items.push(item);

                debug("acquire: new browser; %o", { ...item, browser: null, pages: null, active: item.pages.length });

                return item.pages[0];
            }

            item.counter += 1;
            const page = await item.browser.newPage();
            item.pages.push(page);

            debug("acquire: existing browser; %o", { ...item, browser: null, pages: null, active: item.pages.length });

            return page;
        });
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
                debug("destroy: page closed; %o", { ...item, browser: null, pages: null, active: item.pages.length });
            } else {
                await item.browser.close();
                this.items.splice(itemIndex, 1);
                debug("destroy: last page and browser closed; %o", { ...item, browser: null, pages: null, active: item.pages.length });
            }
        });
    }
}
