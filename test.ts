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
        acquireTimeout: 2_000,
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

test("Calling acquire() and destroy() n(concurrency) times ends with 0 browser instances", async t => {
    const pool = t.context.pool;
    const page1 = await pool.acquire();
    const page2 = await pool.acquire();
    await pool.destroy(page1);
    await pool.destroy(page2);
    const status = pool.status();
    t.is(status.length, 0);
});

test("stop()", async t => {
    const pool = t.context.pool;
    await t.notThrowsAsync(() => pool.stop());
});

test("After stop() all browsers and pages are closed", async t => {
    const pool = t.context.pool;
    const page1 = await pool.acquire();
    const page2 = await pool.acquire();
    await pool.destroy(page1);
    const page3 = await pool.acquire();

    await pool.stop();

    const status = pool.status();
    t.is(status.length, 0);
});

test("acquire() respects concurrency", async t => {
    const pool = t.context.pool;

    const page1 = await pool.acquire();
    const page2 = await pool.acquire();

    await t.throwsAsync(() => pool.acquire(), { instanceOf: Error, message: "Acquire timeout: 2000 ms" });
});

test("Number of acquirers exceeds concurrency", async t => {
    const pool = t.context.pool;

    const acquire = async () => {
        const page = await pool.acquire();
        await new Promise(x => setTimeout(x, 10));
        await pool.destroy(page);
    };

    const acquirers = new Array(10).fill(null).map(acquire);

    await t.notThrowsAsync(async () => await Promise.all(acquirers));
});
