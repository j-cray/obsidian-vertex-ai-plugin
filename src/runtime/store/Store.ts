export * from './types';
import { Writable, Subscriber, Unsubscriber, Updater, StartStopNotifier } from './types';

/**
 * Creates a writable store.
 * @param value Initial value
 * @param start Start/Stop notifier
 */
export function writable<T>(value: T, start: StartStopNotifier<T> = () => { }): Writable<T> {
  let stop: Unsubscriber | null = null;
  const subscribers: Set<Subscriber<T>> = new Set();

  function set(new_value: T): void {
    if (value !== new_value) {
      value = new_value;
      if (stop) { // store is hot
        const run_queue = !subscribers.size;
        for (const subscriber of subscribers) {
          subscriber(value);
        }
      }
    }
  }

  function update(fn: Updater<T>): void {
    set(fn(value));
  }

  function subscribe(run: Subscriber<T>, invalidate: (value?: T) => void = () => { }): Unsubscriber {
    subscribers.add(run);

    if (subscribers.size === 1) {
      // First subscriber, start the store
      stop = start(set, update) || (() => { });
    }

    // Immediate notification
    run(value);

    return () => {
      subscribers.delete(run);
      if (subscribers.size === 0 && stop) {
        stop();
        stop = null;
      }
    };
  }

  function get(): T {
    return value;
  }

  return { set, update, subscribe, get };
}


/**
 * Creates a readable store based on a value or another store.
 */
export function readable<T>(value: T, start: StartStopNotifier<T>): Writable<T> { // returning Writable but typing as needed usually just Readable
  return writable(value, start);
}

/**
 * Derived store implementation could go here if needed.
 */
