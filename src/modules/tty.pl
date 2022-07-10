% tty (terminal) module
% quick & dirty ansi code module
:- module(tty, [tty_clear/0, tty_flush/0, tty_write/1, tty_sgr/1, tty_fill/1, tty_write/2]).
:- use_module(library(lists)).

% clears screen and resets cursor to top left
% might want to rename this
tty_clear :-
	tty_sgr([reset]),
	tty_write_options([at(1/1), clear]),
	flush_output(stdout),
	!.

tty_flush :- flush_output(stdout).

tty_fill(Color) :-
	tty_fill_(bg(Color)).
tty_fill(R, G, B) :-
	tty_fill_(bg(R, G, B)).
tty_fill_(Color) :-
	( sgr(Color, _) -> true
	; throw(error(domain_error(color, Color, tty_fill/1)))),
	tty_write_options([Color]),
	tty_write_ansi(clear).

tty_at(X/Y) :-
	tty_write_ansi(at(X/Y)).

tty_write(Atom) :- tty_write(Atom, []).

tty_write(Atom, Options) :- 
	tty_write_options(Options),
	write(stdout, Atom).

tty_write_options(Options) :-
	maplist(tty_write_ansi, Options),
	( sgr_options(Options, SGR) -> write(stdout, SGR) ; true ).
tty_write_ansi(Arg) :-
	sgr(Arg, _),
	!.
tty_write_ansi(Arg) :-
	( ansi(Arg, Out) -> true
	; throw(error(domain_error(tty_option, Arg)))
	),
	write(stdout, Out),
	!.

ansi(clear, '\x1B\[2J').
ansi(at(X/Y), Out) :- atomic_list_concat(['\x1B\[', Y, ';', X, 'H'], Out).

tty_sgr(Options) :-
	( sgr_options(Options, SGR)
	-> write(stdout, SGR)
	; throw(error(domain_error(sgr, Options, tty_sgr/1)))
	).

sgr_options(Opts, SGR) :- 
	foldl(sgr_options_, Opts, ['\x1B\['], Parts),
	Parts \= [],
	atomic_list_concat(Parts, ';', SGR0),
	atom_concat(SGR0, m, SGR).
	
sgr_options_(Opt, V, V) :- \+sgr(Opt, _).
sgr_options_(Opt, V, V0) :- sgr(Opt, Parts), append(V, Parts, V0). 

% tried and true
sgr(reset, [0]).
sgr(bold, [1]).
sgr(dim, [2]).
sgr(italic, [3]).
sgr(underline, [4]).
sgr(blink, [5]). % intentionally broken on xterm.js?
sgr(inverse, [7]).
sgr(hidden, [8]).
sgr(strikethrough, [9]).
% wacky ones
sgr(fraktur, [20]). % unsupported?
sgr(double_underline, [21]). % becomes regular underline
sgr(regular_weight, [22]).
sgr(frame, [51]). % doesn't work
sgr(encircle, [52]). % doesn't work
sgr(overline, [53]). % doesn't work
% colors
sgr(fg, [39]).
sgr(fg(N), [38, 5, N]).
sgr(fg(R, G, B), [38, 2, R, G, B]).
sgr(bg, [49]).
sgr(bg(N), [48, 5, N]).
sgr(bg(R, G, B), [48, 2, R, G, B]).
