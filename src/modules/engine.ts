import pl from "tau-prolog";
//import * as prolog from "tau-prolog";

// keeps track of mutations within thread
export function engineModule(pl2: typeof pl) {
	new pl2.type.Module("engine", predicates, ["self/1", "stop/0", "stop/1", "current_query/1", "sleep/1"]);
}

const predicates: Record<string, pl.type.PredicateFn> = {
	"self/1": self1,
	"current_query/1": current_query1,
	"stop/0": stop0,
	"stop/1": stop1,
	"sleep/1": sleep1,
}

function self1(thread: pl.type.Thread, point: pl.type.State, atom: pl.type.Term<number, string>) {
	const id = thread.session.ctrl?.parent.id;
	if (!id) {
		return;
	}
	thread.prepend([new pl.type.State(
		point.goal.replace(new pl.type.Term("=", [atom.args[0], new pl.type.Term(id, [])])),
		point.substitution,
		point
	)]);
}

function current_query1(thread: pl.type.Thread, point: pl.type.State, atom: pl.type.Term<number, string>) {
	thread.prepend(Array.from(thread.session.ctrl.parent.queries.keys()).map((id) => {
		return new pl.type.State(
			point.goal.replace(new pl.type.Term("=", [atom.args[0], new pl.type.Term(id, [])])),
			point.substitution,
			point
		)
	}));
}

function stop0(thread: pl.type.Thread, point: pl.type.State, atom: pl.type.Term<number, string>) {
	thread.session.ctrl?.parent?.stop();
	thread.success(point);
}

function stop1(thread: pl.type.Thread, point: pl.type.State, atom: pl.type.Term<number, string>) {
	const pid = atom.args[0];
	if (pl.type.is_variable(atom.args[0])) {
		thread.throw_error(pl.error.instantiation(atom.indicator))
		return;
	}
	if (!pl.type.is_atom(pid)) {
		thread.throw_error(pl.error.type("atom", pid, atom.indicator));
		return;
	}
	thread.session.ctrl?.parent?.stop(pid.id);
	thread.success(point);
}

function sleep1(thread: pl.type.Thread, point: pl.type.State, atom: pl.type.Term<number, string>) {
	const msec = atom.args[0]; 
	if (pl.type.is_variable(msec)) {
		thread.throw_error(pl.error.instantiation(atom.indicator))
		return;
	}
	if (!pl.type.is_number(msec)) {
		thread.throw_error(pl.error.type("number", msec, atom.indicator));
		return;
	}
	setTimeout(() => {
		thread.success(point);
		thread.again();
	}, msec.value);
	return true;
}