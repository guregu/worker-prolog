% tty (terminal) module
% quick & dirty ansi code module
:- module(tty, [tty_clear/0, tty_at/1, tty_write/1, tty_write/2]).
:- use_module(library(lists)).

% clears screen and resets cursor to top left
tty_clear :-
	tty_write_options([at(1/1), reset, clear]),
	flush_output(stdout),
	!.

tty_at(X/Y) :-
	tty_write_ansi([at(X/Y)]).

tty_write(Atom) :- tty_write(Atom, []).

tty_write(Atom, Options) :- 
	tty_write_options(Options),
	write(stdout, Atom),
	flush_output(stdout),
	!.

tty_write_options(Options) :-
	maplist(tty_write_ansi, Options).
tty_write_ansi(Arg) :-
	( ansi(Arg, Out) -> true
	; throw(error(domain_error(tty_option, Arg)))
	),
	write(stdout, Out),
	!.

ansi(clear, '\x1B\[2J').
ansi(reset, '\x1B\[0m').

ansi(at(X/Y), Out) :- atomic_list_concat(['\x1B\[', Y, ';', X, 'H'], Out).
ansi(fg(N), Out) :- atomic_list_concat(['\x1B\[', 38, ';', 5, ';', N, 'm'], Out).
ansi(fg(R, G, B), Out) :- atomic_list_concat(['\x1B\[', 38, ';', 2, ';', R, ';', G, ';', B, 'm'], Out).
ansi(bg(N), Out) :- atomic_list_concat(['\x1B\[', 48, ';', 5, ';', N, 'm'], Out).
ansi(bg(R, G, B), Out) :- atomic_list_concat(['\x1B\[', 48, ';', 2, ';', R, ';', G, ';', B, 'm'], Out).

% TODO: support these ↓
sgr(bold, 1).
sgr(underline, 4).

tty_flush :- flush_output(stdout).
