/**
 * Tranquil Rest PMS — nightly backup to Google Sheets + Google Drive.
 *
 * Paste this into the backup spreadsheet: Extensions → Apps Script.
 * Then run setup() once (see backup/README.md). Every night at ~02:00 (Sri Lanka) it:
 *   1. downloads a full read-only snapshot from Supabase (export_backup RPC),
 *   2. saves the complete JSON (restorable) into the Drive backup folder,
 *   3. refreshes the readable tabs in this spreadsheet,
 *   4. e-mails the owner if anything fails.
 */

var TZ = 'Asia/Colombo';
var DRIVE_FOLDER_ID = '10Iczo9m-yxF-JSbMkItAyUuvGQS5I9eM';
var KEEP_DAILY_DAYS = 60;          // daily JSON files older than this are trashed…
                                   // …except the 1st of each month, kept forever.
var AUDIT_ROWS_IN_SHEET = 5000;    // full audit history is always in the JSON file

// ---------------------------------------------------------------- menu & setup

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tranquil Rest')
    .addItem('Back up now', 'runBackup')
    .addItem('Set Supabase connection…', 'configure')
    .addItem('Install nightly backup', 'installTrigger')
    .addToUi();
}

/** Asks for the three connection values and stores them privately in Script Properties. */
function configure() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var fields = [
    ['SUPABASE_URL', 'Supabase project URL (https://xxxx.supabase.co)'],
    ['SUPABASE_ANON_KEY', 'Supabase anon / public API key'],
    ['BACKUP_KEY', 'Backup key (Admin → Settings → Google backups)'],
  ];
  for (var i = 0; i < fields.length; i++) {
    var res = ui.prompt(fields[i][1], ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    var v = res.getResponseText().trim();
    if (v) props.setProperty(fields[i][0], v);
  }
  ui.alert('Saved. Now choose Tranquil Rest → Back up now to test.');
}

/** Runs runBackup() every night between 02:00 and 03:00 Sri Lanka time. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
  try { SpreadsheetApp.getUi().alert('Nightly backup installed (around 2 AM Sri Lanka time).'); } catch (e) { /* run from editor */ }
}

/** One-shot helper for first-time setup from the script editor. */
function setup() {
  installTrigger();
  runBackup();
}

// ---------------------------------------------------------------- main

function runBackup() {
  var started = new Date();
  var ss = SpreadsheetApp.getActive();
  try {
    var data = fetchSnapshot_();
    var file = saveJson_(data, started);
    writeSheets_(ss, data);
    pruneOldFiles_();
    logRun_(ss, started, 'OK', data, file.getUrl());
  } catch (err) {
    logRun_(ss, started, 'FAILED: ' + err.message, null, '');
    notifyFailure_(err);
    throw err;
  }
}

function fetchSnapshot_() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('SUPABASE_URL');
  var anon = p.getProperty('SUPABASE_ANON_KEY');
  var key = p.getProperty('BACKUP_KEY');
  if (!url || !anon || !key) throw new Error('Not configured: use Tranquil Rest → Set Supabase connection…');

  var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/export_backup', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify({ p_key: key }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Supabase returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  var data = JSON.parse(res.getContentText());
  if (!data || data.format !== 'tranquil-rest-backup/1') throw new Error('Unexpected backup format');
  return data;
}

// ---------------------------------------------------------------- Drive

function monthFolder_(date) {
  var root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var name = Utilities.formatDate(date, TZ, 'yyyy-MM');
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function saveJson_(data, date) {
  var name = 'tranquil-rest-backup-' + Utilities.formatDate(date, TZ, 'yyyy-MM-dd_HHmm') + '.json';
  var blob = Utilities.newBlob(JSON.stringify(data), 'application/json', name);
  return monthFolder_(date).createFile(blob);
}

function pruneOldFiles_() {
  var cutoff = new Date(Date.now() - KEEP_DAILY_DAYS * 86400000);
  var folders = DriveApp.getFolderById(DRIVE_FOLDER_ID).getFolders();
  while (folders.hasNext()) {
    var files = folders.next().getFiles();
    var firstOfMonthKept = {};
    while (files.hasNext()) {
      var f = files.next();
      var m = f.getName().match(/^tranquil-rest-backup-(\d{4}-\d{2})-(\d{2})_/);
      if (!m) continue;
      if (m[2] === '01' && !firstOfMonthKept[m[1]]) { firstOfMonthKept[m[1]] = true; continue; }
      if (f.getDateCreated() < cutoff) f.setTrashed(true);
    }
  }
}

// ---------------------------------------------------------------- Sheets

function fmt_(iso) {
  return iso ? Utilities.formatDate(new Date(iso), TZ, 'yyyy-MM-dd HH:mm') : '';
}
function num_(v) { return v === null || v === undefined ? 0 : Number(v); }

var TYPE_EN = { short_time: 'Short Time', day: 'Day', night: 'Night', full_day: 'Full Day' };
var STATUS_EN = { booked: 'Booked', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled' };

function writeSheets_(ss, d) {
  var rooms = indexBy_(d.rooms, 'id');
  var people = indexBy_(d.profiles, 'id');
  var bookingsById = indexBy_(d.bookings, 'id');
  var paidBy = sumBy_(d.payments, 'booking_id', 'amount');
  var addonsBy = sumBy_(d.booking_addons, 'booking_id', 'amount');
  var roomName = function (id) { return rooms[id] ? rooms[id].name : ''; };
  var person = function (id) { return id && people[id] ? people[id].display_name : ''; };

  writeTab_(ss, 'Bookings',
    ['Check-in', 'Check-out', 'Room', 'Type', 'Status', 'Guest name', 'Phone', 'Room charge', 'Add-ons', 'Total', 'Paid', 'Balance',
     'Created at', 'Created by', 'Cancelled at', 'Cancel reason', 'Notes', 'Booking ID'],
    d.bookings.slice().reverse().map(function (b) {
      var addons = addonsBy[b.id] || 0, paid = paidBy[b.id] || 0, total = num_(b.room_charge) + addons;
      return [fmt_(b.check_in_time), fmt_(b.check_out_time), roomName(b.room_id), TYPE_EN[b.booking_type] || b.booking_type,
        STATUS_EN[b.status] || b.status, b.guest_name || '', "'" + b.guest_phone, num_(b.room_charge), addons, total, paid,
        b.status === 'cancelled' ? 0 : Math.max(0, total - paid), fmt_(b.created_at), person(b.created_by),
        fmt_(b.cancelled_at), b.cancel_reason || '', b.notes || '', b.id];
    }), [8, 9, 10, 11, 12]);

  writeTab_(ss, 'Payments',
    ['Paid at', 'Room', 'Guest phone', 'Kind', 'Method', 'Amount', 'Recorded by', 'Booking ID', 'Payment ID'],
    d.payments.slice().reverse().map(function (p) {
      var b = bookingsById[p.booking_id] || {};
      return [fmt_(p.paid_at), roomName(b.room_id), b.guest_phone ? "'" + b.guest_phone : '', p.kind, p.method === 'cash' ? 'Cash' : 'Bank',
        num_(p.amount), person(p.created_by), p.booking_id, p.id];
    }), [6]);

  writeTab_(ss, 'Food & Drinks',
    ['Added at', 'Room', 'Item', 'Unit price', 'Qty', 'Amount', 'Booking ID'],
    d.booking_addons.slice().reverse().map(function (a) {
      var b = bookingsById[a.booking_id] || {};
      return [fmt_(a.created_at), roomName(b.room_id), a.label, num_(a.unit_price), a.quantity, num_(a.amount), a.booking_id];
    }), [4, 6]);

  writeTab_(ss, 'Expenses',
    ['Date', 'Type', 'Category', 'Amount', 'Note', 'Entered at', 'Expense ID'],
    d.expenses.slice().reverse().map(function (e) {
      return [e.expense_date, e.expense_type === 'fixed' ? 'Fixed' : 'Variable', e.category, num_(e.amount), e.note || '', fmt_(e.created_at), e.id];
    }), [4]);

  writeTab_(ss, 'Monthly', ['Month', 'Cash collected', 'Bank collected', 'Total collected', 'Fixed expenses', 'Variable expenses', 'Total expenses', 'Net profit', 'Bookings', 'Cancelled'],
    monthly_(d), [2, 3, 4, 5, 6, 7, 8]);

  var settingsRows = [['Property', d.settings.property_name, '', ''], ['Cleaning buffer (min)', d.settings.cleaning_buffer_minutes, '', ''], ['', '', '', '']];
  settingsRows.push(['ROOM', 'Category', 'Active', 'Sinhala name']);
  d.rooms.forEach(function (r) { settingsRows.push([r.name, r.category === 'ac' ? 'AC' : 'Non-AC', r.active ? 'Yes' : 'No', r.name_si]); });
  settingsRows.push(['', '', '', '']);
  settingsRows.push(['PRICE: category / type', 'Price (LKR)', 'Default times', 'Duration (h)']);
  d.pricing_rules.forEach(function (p) {
    settingsRows.push([(p.category === 'ac' ? 'AC' : 'Non-AC') + ' / ' + (TYPE_EN[p.booking_type] || p.booking_type), num_(p.price),
      p.default_start_time ? p.default_start_time.slice(0, 5) + ' – ' + p.default_end_time.slice(0, 5) : '', p.duration_minutes ? p.duration_minutes / 60 : '']);
  });
  writeTab_(ss, 'Settings', ['Item', 'Value', '', ''], settingsRows, []);

  writeTab_(ss, 'Audit',
    ['When', 'Who', 'Action', 'Record type', 'Changed fields', 'Record ID'],
    d.audit_logs.slice(-AUDIT_ROWS_IN_SHEET).reverse().map(function (l) {
      return [fmt_(l.created_at), l.actor_name || 'system', l.action, l.table_name, changedFields_(l), l.record_id || ''];
    }), []);
}

/** Replaces a tab's contents in one write; creates and formats the tab if missing. */
function writeTab_(ss, name, header, rows, moneyCols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  var all = [header].concat(rows);
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  if (rows.length) {
    moneyCols.forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('#,##0'); });
  }
}

function monthly_(d) {
  var m = {};
  var get = function (k) { return m[k] || (m[k] = { cash: 0, bank: 0, fixed: 0, variable: 0, bookings: 0, cancelled: 0 }); };
  d.payments.forEach(function (p) { var r = get(Utilities.formatDate(new Date(p.paid_at), TZ, 'yyyy-MM')); r[p.method] += num_(p.amount); });
  d.expenses.forEach(function (e) { get(e.expense_date.slice(0, 7))[e.expense_type] += num_(e.amount); });
  d.bookings.forEach(function (b) { var r = get(Utilities.formatDate(new Date(b.check_in_time), TZ, 'yyyy-MM')); if (b.status === 'cancelled') r.cancelled++; else r.bookings++; });
  return Object.keys(m).sort().reverse().map(function (k) {
    var r = m[k], collected = r.cash + r.bank, exp = r.fixed + r.variable;
    return [k, r.cash, r.bank, collected, r.fixed, r.variable, exp, collected - exp, r.bookings, r.cancelled];
  });
}

function changedFields_(l) {
  if (!l.old_data || !l.new_data) return '';
  var skip = { updated_at: 1, updated_by: 1, created_at: 1 };
  return Object.keys(l.new_data).filter(function (k) {
    return !skip[k] && JSON.stringify(l.old_data[k]) !== JSON.stringify(l.new_data[k]);
  }).map(function (k) { return k + ': ' + l.old_data[k] + ' → ' + l.new_data[k]; }).join('; ');
}

function logRun_(ss, started, status, data, link) {
  var sh = ss.getSheetByName('Backup Log');
  if (!sh) {
    sh = ss.insertSheet('Backup Log', 0);
    sh.appendRow(['Backup time (Sri Lanka)', 'Status', 'Bookings', 'Payments', 'Expenses', 'Audit entries', 'JSON file', 'Seconds']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  }
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 8).setValues([[
    Utilities.formatDate(started, TZ, 'yyyy-MM-dd HH:mm'), status,
    data ? data.bookings.length : '', data ? data.payments.length : '', data ? data.expenses.length : '', data ? data.audit_logs.length : '',
    link, Math.round((Date.now() - started.getTime()) / 1000),
  ]]);
  sh.getRange(2, 2).setFontColor(status === 'OK' ? '#15803d' : '#b91c1c').setFontWeight('bold');
}

function notifyFailure_(err) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Tranquil Rest backup FAILED',
      'The nightly backup did not complete.\n\nError: ' + err.message + '\n\nOpen the backup spreadsheet → Backup Log for details.');
  } catch (e) { /* mail quota exhausted – the log row still records the failure */ }
}

function indexBy_(arr, key) { var o = {}; arr.forEach(function (x) { o[x[key]] = x; }); return o; }
function sumBy_(arr, key, field) { var o = {}; arr.forEach(function (x) { o[x[key]] = (o[x[key]] || 0) + num_(x[field]); }); return o; }
