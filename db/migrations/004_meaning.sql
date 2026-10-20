-- What each item means, as numbers (a Gemini embedding), for "find similar"
-- and for searching by meaning rather than exact words.

alter table items add column embedding real[];
