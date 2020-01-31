import { Page, Browser } from "puppeteer";

type Emitter = {
    emit(event: "after_close", page: Page): boolean;
    emit(event: "error", err: Error): boolean;
}

export class CloseQueue {
    private pages: Page[] = [];
    private browsers: Browser[] = [];

    constructor(private emitter: Emitter) {
    }

    addPage(...page: Page[]) {
        this.pages.push(...page);
    }

    addBrowser(...browser: Browser[]) {
        this.browsers.push(...browser);
    }

    async closeAll() {
        const pages = this.pages;
        this.pages = [];

        const browsers = this.browsers;
        this.browsers = [];

        await Promise.all(pages.map(page => this.close(page, page => this.emitter.emit("after_close", page))));
        await Promise.all(browsers.map(browser => this.close(browser)));
    }

    private async close<T extends Page | Browser>(closable: T, onClosed?: (closable: T) => void) {
        try {
            await closable.close();
            if (onClosed) {
                onClosed(closable);
            }
        } catch (err) {
            this.emitter.emit("error", err);
        }
    }
}
