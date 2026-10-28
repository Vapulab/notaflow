import { lookup } from 'node:dns/promises';

export interface TrustedPeer {
  has(address: string): boolean;
  // Settles after the first lookup, found or not.
  ready: Promise<void>;
  close(): void;
}

const resolveAll = async (host: string) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

// Docker gives a container a new address when it restarts, so the name is resolved again every minute.
export function trustedPeer(
  host: string,
  options: { resolve?: (host: string) => Promise<string[]>; refreshMs?: number } = {},
): TrustedPeer {
  const resolve = options.resolve ?? resolveAll;
  let addresses = new Set<string>();
  // A failed lookup keeps the last addresses, so a DNS hiccup does not drop the tunnel.
  const refresh = () =>
    resolve(host).then(
      (list) => {
        addresses = new Set(list.map(plain));
      },
      () => undefined,
    );
  const ready = refresh();
  const timer = setInterval(() => void refresh(), options.refreshMs ?? 60_000);
  timer.unref();
  return {
    has: (address) => addresses.has(plain(address)),
    ready,
    close: () => clearInterval(timer),
  };
}

const plain = (address: string) => address.replace(/^::ffff:/, '');
