import anyTest, { TestInterface } from "ava";

import { Page } from "puppeteer";
import { PuppeteerPool } from "./index";

const test = anyTest as TestInterface<{
    pool: PuppeteerPool;
}>;

test.beforeEach(t => {
    t.context.pool = new PuppeteerPool({
        concurrency: 2,
        launchOptions: {
            headless: true,
        },
    });
});

test.afterEach.always(t => {
    t.context.pool.stop();
    t.context.pool.removeAllListeners();
});

test("Constructor returns instance", t => {
    t.assert(t.context.pool instanceof PuppeteerPool);
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
    t.assert(status[0].lifetime >= 0);
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

    await t.throwsAsync(() => pool.acquire(), { instanceOf: Error, message: "Acquire timeout: 45000 ms" });
});

test("Number of acquirers exceeds concurrency", async t => {
    const pool = t.context.pool;

    const acquire = async () => {
        const page = await pool.acquire();
        await pool.destroy(page);
    };

    const acquirers = new Array(10).fill(null).map(acquire);

    await t.notThrowsAsync(async () => await Promise.all(acquirers));
});

test("acquire() emits after_acquire event", async t => {
    const pool = t.context.pool;

    t.plan(2);

    let pageFromEvent: Page | null = null;

    pool.on("after_acquire", page => {
        t.pass("after_acquire emitted");
        pageFromEvent = page;
    });

    const page = await pool.acquire();

    t.is(pageFromEvent, page);
});

test("acquire() emits after_acquire event with provided opts", async t => {
    type PageOpts = { a: number; b: number; c: number };

    const pool = new PuppeteerPool<PageOpts>({ concurrency: 1 });

    t.plan(2);

    const opts = { a: 1, b: 2, c: 3 };
    let optsFromEvent: PageOpts | null = null;

    pool.on("after_acquire", (page, opts) => {
        t.pass("after_acquire emitted");
        optsFromEvent = opts;
    });

    await pool.acquire(opts);

    t.is(optsFromEvent, opts);

    pool.stop();
    pool.removeAllListeners();
});

test("destroy() emits after_destroy event", async t => {
    const pool = t.context.pool;

    t.plan(2);

    const page = await pool.acquire();

    let pageFromEvent: Page | null = null;

    pool.on("after_destroy", page => {
        t.pass("after_destroy emitted");
        pageFromEvent = page;
    });

    await pool.destroy(page);
    await new Promise(x => setTimeout(x, 500));

    t.is(pageFromEvent, page);
});
