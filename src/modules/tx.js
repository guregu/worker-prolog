// @ts-nocheck

// keeps track of mutations within thread
export function transactions(pl) {
	function replace(pi) {
		const pred = pl.builtin.rules[pi];
		pl.builtin.rules[pi] = function(thread, point, atom) {
			if (!thread.tx) {
				thread.tx = [];
			}
			thread.tx.push(atom);
			pred.apply(this, arguments);
		};
	}
	for (const pi of ["asserta/1", "assertz/1", "retract/1", /*"retractall/1",*/ "abolish/1"]) {
		replace(pi);
	}
}

// adds pengine module linking
// :- use_module(application(App)).
export function linkedModules(pl) {
	const useMod = pl.directive["use_module/1"];
	pl.directive["use_module/1"] = function(thread, term, _) {
		const id = term.args[0];
		if (pl.type.is_term(id) && pl.type.is_atom(id.args[0])) {
			if (id.indicator === "application/1") {
				const name = id.args[0].id;
				console.log("linking app...", id.toString());
				thread.session.ctrl.defer(thread.session.ctrl.parent.linkApp(name));
				return true;
			}
		}
		useMod.apply(this, arguments);
	}
}
