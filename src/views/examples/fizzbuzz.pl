fizzbuzz(N, Max) :- 
	N =< Max,
	findall(_, say(N), _), nl,
	succ(N, N1),
	fizzbuzz(N1, Max).
fizzbuzz(N, Max) :- succ(Max, N).

say(N) :- 0 is N mod 3, write('fizz').
say(N) :- 0 is N mod 5, write('buzz').
say(N) :-
	X is N mod 3,
	X \= 0,
	Y is N mod 5,
	Y \= 0,
	write(N).

% ?- fizzbuzz(1, 15)
