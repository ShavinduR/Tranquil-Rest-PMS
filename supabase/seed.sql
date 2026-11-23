-- Default data for Tranquil Rest. Safe to re-run.

insert into public.rooms (room_number, name, name_si, category) values
  (1, 'Room 1', 'කාමර 1', 'non_ac'),
  (2, 'Room 2', 'කාමර 2', 'non_ac'),
  (3, 'Room 3', 'කාමර 3', 'non_ac'),
  (4, 'Room 4', 'කාමර 4', 'non_ac'),
  (5, 'Room 5', 'කාමර 5', 'non_ac')
on conflict (room_number) do nothing;

-- Non-AC defaults (LKR). AC rows are pre-created so the owner only has to set
-- prices and flip a room's category in Settings when AC is installed.
insert into public.pricing_rules (category, booking_type, price, default_start_time, default_end_time, duration_minutes) values
  ('non_ac', 'short_time', 1500, null,    null,    180),
  ('non_ac', 'day',        2000, '08:00', '17:00', null),
  ('non_ac', 'night',      2500, '18:00', '08:00', null),
  ('non_ac', 'full_day',   3500, null,    null,    1440),
  ('ac',     'short_time', 2000, null,    null,    180),
  ('ac',     'day',        2800, '08:00', '17:00', null),
  ('ac',     'night',      3500, '18:00', '08:00', null),
  ('ac',     'full_day',   5000, null,    null,    1440)
on conflict (category, booking_type) do nothing;

insert into public.addon_presets (label_si, label_en, price, sort_order)
select * from (values
  ('තේ',            'Tea',             100::numeric, 1),
  ('කෝපි',          'Coffee',          150::numeric, 2),
  ('වතුර බෝතල්',    'Water bottle',    150::numeric, 3),
  ('උදේ කෑම',       'Breakfast',       500::numeric, 4),
  ('දවල් කෑම',      'Lunch',           700::numeric, 5),
  ('රාත්‍රී කෑම',    'Dinner',          700::numeric, 6),
  ('සිසිල් බීම',     'Soft drink',      200::numeric, 7)
) v(label_si, label_en, price, sort_order)
where not exists (select 1 from public.addon_presets);
