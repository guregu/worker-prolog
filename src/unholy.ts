const CURRENT_VERSION = 0;

export class Store<T> {
	storage: DurableObjectStorage;
	key: string;
	reviver: any;

	public constructor(storage: DurableObjectStorage, key: string, types: Record<string, any>) {
		this.storage = storage;
		this.key = key;
		this.reviver = makeReviver(types);
	}

	public async get(id: string): Promise<T | undefined> {
		const raw = await this.storage.get(this.path(id));
		if (raw === undefined) {
			return undefined;
		}
		if (typeof raw !== "string") {
			throw(`unexpected value in get: ${raw}`);
		}
		return JSON.parse(raw, this.reviver);
	}

	public async record(id: string, prefix?: string): Promise<Record<string, T>> {
		const path = `${this.path(id)}:${prefix ?? ""}`;
		const items = await this.storage.list({
			prefix: path,
		});
		const record: Record<string, T> = {};
		for (const [k, raw] of items.entries()) {
			if (typeof raw !== "string") {
				throw(`unexpected value in record: ${raw}`);
			}
			const v = JSON.parse(raw, this.reviver);
			record[k.slice(path.length)] = v;
		}
		return record;
	}

	public async put(id: string, v: T): Promise<void> {
		const enc = JSON.stringify(v, replacer);
		return this.storage.put(this.path(id), enc);
	}

	public async delete(id: string): Promise<boolean> {
		return this.storage.delete(this.path(id));
	}

	private path(id: string): string {
		return `id:${id}:v${CURRENT_VERSION}:${this.key}`;
	}
}

export function replacer(this, k, x): any {
	if (Array.isArray(x)) {
		return x.map(function(v) { return replacer(null, v); });
	}
	if (typeof x == "object" && x != null) {
		const proto = Object.getPrototypeOf(x);
		const name = proto.constructor.name;
		if (name == "Object") {
			return x;
		}
		if (proto) {
			return {...x, "_proto": name};
		}
	}
	return x;
}

export function makeReviver(types?: {} = globalThis) {
	return function(k, v) {
		if (typeof v !== "object" || v == null) {
			return v;
		}
		if (typeof v._proto !== "string") {
			return v;
		}
		const proto = types[v._proto];
		if (!proto || !proto?.prototype) {
			return v;
		}
		delete v._proto;
		Object.setPrototypeOf(v, proto.prototype);
		return v;
	};
}