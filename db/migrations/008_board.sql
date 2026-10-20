-- Where you stuck each note on the board. x is a share of the board's width
-- (so phone and laptop agree), y is pixels from the top; null means not placed yet.
alter table items
  add column board_x real,
  add column board_y real,
  add column board_tilt real;
