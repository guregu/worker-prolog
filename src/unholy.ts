const CURRENT_VERSION = 1;
const PROTO_KEY = "$$proto";

export class Store<T> {
	storage: DurableObjectStorage;
	key: string;
	reviver: (k: string, v: any) => any | undefined;

	public constructor(storage: DurableObjectStorage, key: string, types: Record<string, any>) {
		this.storage = storage;
		this.key = key;
		this.reviver = makeReviver(types);
	}

	public async get(): Promise<T | undefined> {
		const raw = await this.storage.get(this.path());
		if (raw === undefined) {
			return undefined;
		}
		if (typeof raw !== "string") {
			throw(`unexpected value in get: ${raw}`);
		}
		return JSON.parse(raw, this.reviver);
	}

	public async record(prefix?: string): Promise<Record<string, T>> {
		const suffix = prefix ? prefix+":" : "";
		const path = `${this.path()}::${suffix}`;
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
			console.log("@@ getRecord:", path, k.slice(path.length), raw.slice(0, 10));
		}
		return record;
	}

	public async put(v: T): Promise<void> {
		const path = this.path();
		const enc = this.encode(v);
		return this.storage.put(path, enc);
	}

	public async putRecord(prefix: string, record: Record<string, T>) {
		const put: Record<string, string> = {};
		for (const [key, value] of Object.entries(record)) {
			const path = this.recordPath(prefix, key);
			const enc = this.encode(value);
			put[path] = enc;
			console.log("@@ putRecord:", path, enc.slice(0, 10));
		}
		
		return this.storage.put(put);
	}

	public async putRecordItem(prefix: string, key: string, value: T) {
		const path = this.recordPath(prefix, key);
		const enc = this.encode(value);
		return this.storage.put(path, enc);
	}

	public async delete(): Promise<boolean> {
		return this.storage.delete(this.path());
	}

	private encode(value: T): string {
		return JSON.stringify(value, replacer);
	}

	private path(): string {
		return `${this.key}:v${CURRENT_VERSION}`;
	}

	private recordPath(prefix = "", key = ""): string {
		return `${this.path()}::${prefix}:${key}`;
	}
}

export function replacer(k, v): any {
	if (Array.isArray(v)) {
		return v.map(function(x, y) { return replacer(y, x); });
	}
	if (typeof v == "object" && v != null) {
		const proto = Object.getPrototypeOf(v);
		const name = proto.constructor.name;
		if (name === "Object") {
			return v;
		}
		if (proto) {
			return {...v, [PROTO_KEY]: name};
		}
	}
	return v;
}

export function makeReviver(types: Record<string, any> = globalThis) {
	return function(k, v) {
		if (typeof v !== "object" || v == null) {
			return v;
		}
		if (typeof v[PROTO_KEY] !== "string") {
			return v;
		}
		const proto = types[v[PROTO_KEY]];
		if (!proto || !proto?.prototype) {
			return v;
		}
		delete v[PROTO_KEY];
		Object.setPrototypeOf(v, proto.prototype);
		return v;
	};
}

export async function parseResponse(resp: Response, types: Record<string, any> = globalThis): Promise<any> {
	const reviver = makeReviver(types);
	const text = await resp.text();
	return JSON.parse(text, reviver);
}

export function makeResponse(obj: any): Response {
	const text = JSON.stringify(obj, replacer);
	return new Response(text, {
		headers: {
			"Content-Type": "application/json; charset=UTF-8"
		}
	});
}