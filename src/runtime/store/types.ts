export type Subscriber<T> = (value: T) => void;
export type Unsubscriber = () => void;
export type Updater<T> = (value: T) => T;
export type StartStopNotifier<T> = (set: (value: T) => void, update: (fn: Updater<T>) => void) => void | Unsubscriber;

export interface Readable<T> {
    /**
     * Subscribe to value changes.
     * @param run subscription callback
     * @param invalidate cleanup callback
     */
    subscribe(this: void, run: Subscriber<T>, invalidate?: (value?: T) => void): Unsubscriber;

    /**
     * Get current value synchronously.
     */
    get(this: void): T;
}


export interface Writable<T> extends Readable<T> {
    /**
     * Set value and inform subscribers.
     * @param value to set
     */
    set(this: void, value: T): void;

    /**
     * Update value using callback and inform subscribers.
     * @param updater callback
     */
    update(this: void, updater: Updater<T>): void;
}
