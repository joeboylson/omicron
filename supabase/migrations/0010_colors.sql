-- Colors for statuses and labels, by name from Apple's system colors (the
-- web page picks the light or dark shade). No color means the default:
-- gray, or green for the Done status.

alter table public.statuses add column color text;
alter table public.statuses add constraint statuses_color check (
  color in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray')
);
alter table public.labels add constraint labels_color check (
  color in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray')
);
