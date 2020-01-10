import anyTest, { TestInterface } from "ava";

import { Page } from "puppeteer";
import { PuppeteerPool } from "./index";

const test = anyTest as TestInterface<{
    pool: PuppeteerPool;
}>;

test.beforeEach(t => {
    t.context.pool = new PuppeteerPool({
        launchOptions: {
            ignoreHTTPSErrors: true,
            timeout: 60000,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-features=site-per-process",
                "--disable-extensions",
            ],
        },
        concurrency: 2,
    });
});

test("Constructor returns instance", t => {
    t.assert(t.context.pool instanceof PuppeteerPool);
});

test("Throws Error if concurrency < 1", t => {
    t.throws(
        () => new PuppeteerPool({ concurrency: 0 }),
        {
            instanceOf: Error,
            message: "Concurrency option must be provided (>= 1)",
        }
    );
});

test("acquire() returns Page", async t => {
    const pool = t.context.pool;
    const page = await pool.acquire();
    t.truthy(page);
});

test("destroy()", async t => {
    const pool = t.context.pool;
    const page = await pool.acquire();
    await t.notThrowsAsync(() => pool.destroy(page));
});

test("status() returns status object", async t => {
    const pool = t.context.pool;
    const page = await pool.acquire();
    const status = pool.status();
    t.assert(status.length === 1);
    t.assert(status[0].lifetime > 0);
    t.assert(status[0].counter === 1);
    t.assert(status[0].active === 1);
});

test("stop()", async t=> {
    const pool = t.context.pool;
    await t.notThrowsAsync(() => pool.stop());
});