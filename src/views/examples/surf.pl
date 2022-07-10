:- use_module(library(tty)).

% channel surfs through the 8-bit terminal colors
surf :-
	between(0, 255, N),
	tty_fill(N),
	tty_write(N, [at(1/1), bg, fg]),
	tty_write('prolog.run', [at(20/10), bg(N), fg, bold, italic]),
	sleep(700).

% ?- surf.
