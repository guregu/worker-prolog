:- use_module(library(tty)).
:- use_module(library(random)).

clear :- tty_clear.

twinkle(Glyph, Delay) :-
	repeat,
	random(1, 200, X),
	random(1, 1, Y),
	tty_at(X/Y), write(Glyph),
	sleep(Delay).

% ?- twinkle('.', 300).
% ?- twinkle('⋆', 500).
% ?- twinkle('☆', 900).
% ?- twinkle('⁂', 1100).
% ?- twinkle('🌜', 8000).
% ?- twinkle('🌌', 3000).
% ?- twinkle(' ', 200).
% ?- clear.
% ?- repeat, clear, sleep(10000).
