type Emitter = {
    emit(event: "error", err: Error): boolean;
}

export class AsyncSerial {
    private counter = 0;

    constructor(private emitter: Emitter) {
    }

    run(fn: () => Promise<void>) {
        this.counter += 1;
        if (this.counter > 1) {
            return;
        }

        setImmediate(async () => {
            while (this.counter > 0) {
                try {
                    await fn();

                    this.counter -= 1;
                    if (this.counter > 0) {
                        this.counter = 1;
                    }
                } catch (err) {
                    this.emitter.emit("error", err);
                    await new Promise(x => setTimeout(x, 1_000));
                }
            }
        });
    }
}
