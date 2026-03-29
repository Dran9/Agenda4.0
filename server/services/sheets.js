const { google } = require('googleapis');
const { getOAuthClient } = require('./calendar');

function getSheetsService() {
  return google.sheets({ version: 'v4', auth: getOAuthClient() });
}

const SPREADSHEET_ID = () => process.env.GOOGLE_SHEETS_ID;

// Sync a single client row to the "Clientes" sheet
async function syncClientToSheet(client) {
  const spreadsheetId = SPREADSHEET_ID();
  if (!spreadsheetId) return; // Sheets not configured

  const sheets = getSheetsService();
  const sheetName = 'Clientes';

  // Ensure header row exists
  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:J1`,
    });
    if (!headerRes.data.values || headerRes.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:J1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['ID', 'Teléfono', 'Nombre', 'Apellido', 'Ciudad', 'País', 'Edad', 'Arancel', 'Fuente', 'Fecha registro']],
        },
      });
    }
  } catch (err) {
    // Sheet might not exist, try creating it
    if (err.code === 400 || err.message?.includes('Unable to parse range')) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:J1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['ID', 'Teléfono', 'Nombre', 'Apellido', 'Ciudad', 'País', 'Edad', 'Arancel', 'Fuente', 'Fecha registro']],
          },
        });
      } catch (createErr) {
        console.error('[sheets] Could not create sheet:', createErr.message);
        return;
      }
    } else {
      console.error('[sheets] Header check error:', err.message);
      return;
    }
  }

  // Find if client already has a row (by ID in column A)
  try {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
    });
    const rows = existing.data.values || [];
    const rowIdx = rows.findIndex(r => String(r[0]) === String(client.id));

    const rowData = [
      client.id,
      client.phone,
      client.first_name,
      client.last_name || '',
      client.city || '',
      client.country || 'Bolivia',
      client.age || '',
      client.fee || '',
      client.source || '',
      client.created_at ? new Date(client.created_at).toLocaleDateString('es-BO') : new Date().toLocaleDateString('es-BO'),
    ];

    if (rowIdx >= 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A${rowIdx + 1}:J${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowData] },
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:J`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowData] },
      });
    }
    console.log(`[sheets] Client synced: ${client.first_name} (${client.id})`);
  } catch (err) {
    console.error('[sheets] Sync error:', err.message);
  }
}

// Sync a booking to the "Citas" sheet
async function syncBookingToSheet(appointment, client) {
  const spreadsheetId = SPREADSHEET_ID();
  if (!spreadsheetId) return;

  const sheets = getSheetsService();
  const sheetName = 'Citas';

  // Ensure header
  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:I1`,
    });
    if (!headerRes.data.values || headerRes.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:I1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['ID', 'Cliente', 'Teléfono', 'Fecha', 'Hora', 'Estado', 'Sesión #', 'Primera vez', 'Confirmado']],
        },
      });
    }
  } catch (err) {
    if (err.code === 400 || err.message?.includes('Unable to parse range')) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:I1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['ID', 'Cliente', 'Teléfono', 'Fecha', 'Hora', 'Estado', 'Sesión #', 'Primera vez', 'Confirmado']],
          },
        });
      } catch (createErr) {
        console.error('[sheets] Could not create Citas sheet:', createErr.message);
        return;
      }
    } else {
      return;
    }
  }

  const dt = new Date(appointment.date_time);
  const fecha = dt.toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' });
  const hora = dt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });

  const rowData = [
    appointment.id,
    `${client.first_name} ${client.last_name || ''}`.trim(),
    client.phone,
    fecha,
    hora,
    appointment.status || 'Agendada',
    appointment.session_number || '',
    appointment.is_first ? 'Sí' : 'No',
    appointment.confirmed_at ? 'Sí' : '',
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:I`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
    console.log(`[sheets] Booking synced: ${client.first_name} @ ${fecha} ${hora}`);
  } catch (err) {
    console.error('[sheets] Booking sync error:', err.message);
  }
}

module.exports = { syncClientToSheet, syncBookingToSheet };
