const ExcelJS = require('exceljs');

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Agenda4.0';
  workbook.company = 'Agenda4.0';
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

function styleHeaderRow(worksheet, rowNumber = 1) {
  const row = worksheet.getRow(rowNumber);
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
  });
}

function styleDataGrid(worksheet, startRow = 2) {
  for (let rowIndex = startRow; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFF1F5F9' } },
      };
    });
  }
}

function autoFitColumns(worksheet, minWidth = 10, maxWidth = 36) {
  worksheet.columns.forEach((column) => {
    let maxLength = minWidth;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value == null ? '' : String(cell.value);
      maxLength = Math.max(maxLength, value.length + 2);
    });
    column.width = Math.min(Math.max(maxLength, minWidth), maxWidth);
  });
}

function freezeHeader(worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function setAutoFilter(worksheet) {
  if (!worksheet.columnCount || !worksheet.rowCount) return;
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };
}

function formatDateBolivia(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'America/La_Paz',
  });
}

module.exports = {
  autoFitColumns,
  createWorkbook,
  formatDateBolivia,
  freezeHeader,
  setAutoFilter,
  styleDataGrid,
  styleHeaderRow,
};
