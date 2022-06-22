// @ts-nocheck

// augments json package with true/false/null support
export function betterJSON(pl, functor = "{}") {
	// JS → Prolog
	pl.fromJavaScript.conversion.boolean = function(obj) {
		return new pl.type.Term(functor, [
			new pl.type.Term(obj ? "true" : "false", [])
		]);
	};
	const js2term = pl.fromJavaScript.conversion.object;
	pl.fromJavaScript.conversion.object = function(obj) {
		if (obj === null) {
			return new pl.type.Term(functor, [
				new pl.type.Term("null", [])
			]);
		}
		return js2term.apply(this, arguments);
	};

	// Prolog → JS
	const term2js = pl.type.Term.prototype.toJavaScript;
	pl.type.Term.prototype.toJavaScript = function() {
		if (this.indicator == functor + "/1") {
			switch (this.args[0].indicator) {
			case "true/0": return true;
			case "false/0": return false;
			case "null/0": return null;
			case "undefined/0": return undefined;
			}
		}
		return term2js.apply(this, arguments);
	};
}
