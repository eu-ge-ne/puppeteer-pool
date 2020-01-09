import { Page, Browser, launch, LaunchOptions } from "puppeteer";
import { Pool, createPool } from "generic-pool";
import { LockAsync } from "@eu-ge-ne/lock-async";

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
    created: number;
    browser: Browser;
    counter: number;
    active: number;
};

export class PuppeteerPool {
    private readonly items: Item[] = [];
    private readonly pool: Pool<Page>;
    private readonly lock = new LockAsync();

    public constructor(private readonly options: Options) {
        if (this.options.concurrency < 1) {
            throw new Error("Concurrency option must be provided (>= 1)");
        }

        this.pool = createPool(
            {
                create: () => this.factoryCreate(),
                destroy: (page: Page) => this.factoryDestroy(page),
            },
            {
                max: this.options.concurrency,
            });
    }

    public async stop() {
        await this.pool.drain();
        await this.pool.clear();

        for (const item of this.items) {
            await item.browser.close();
        }
    }

    public status(): Status {
        return this.items.map(x => ({
            lifetime: Date.now() - x.created,
            counter: x.counter,
            active: x.active,
        }));
    }

    private async factoryCreate(): Promise<Page> {
        return await this.lock.run(async () => {
            let item = this.items.find(x => x.counter < this.options.concurrency);

            if (!item) {
                const browser = this.options.launch
                    ? await this.options.launch()
                    : await launch(this.options.launchOptions);
                item = { created: Date.now(), browser, counter: 0, active: 0 };
                this.items.push(item);
            }

            item.counter += 1;
            item.active += 1;

            return item.browser.newPage();
        });
    }

    private async factoryDestroy(page: Page) {
        await this.lock.run(async () => {
            const browser = page.browser();
            const index = this.items.findIndex(x => x.browser === browser);
            if (index < 0) {
                throw new Error("Browser not found in pool");
            }

            await page.close();

            const item = this.items[index];

            item.active -= 1;

            if (item.counter >= this.options.concurrency) {
                if (item.active === 0) {
                    await item.browser.close();
                    this.items.splice(index, 1);
                }
            }
        });
    }

    public async acquire(): Promise<Page> {
        return this.pool.acquire();
    }

    public async destroy(page: Page): Promise<void> {
        await this.pool.destroy(page);
    }
}
