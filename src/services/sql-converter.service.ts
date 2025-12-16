import { Injectable } from '@angular/core';

export interface ColumnDefinition {
  name: string;
  type: string;
  sampleValues: string[];
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
}

export interface ColumnAddition {
  name: string;
  type: string;
  defaultValue?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SqlConverterService {

  constructor() {}

  async convertSql(mysqlCode: string): Promise<string> {
    if (!mysqlCode.trim()) return '';

    // Simulate a brief processing delay for UI feedback
    await new Promise(resolve => setTimeout(resolve, 400));

    let sql = mysqlCode;
    const notes: string[] = [];

    // --- 1. Syntax & Quoting ---
    sql = sql.replace(/`/g, '"');
    sql = sql.replace(/^#/gm, '--');
    sql = sql.replace(/ #/g, ' --');

    // --- 2. Data Type Mapping ---
    sql = sql.replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'BOOLEAN');
    sql = sql.replace(/\bBOOL\b/gi, 'BOOLEAN');
    sql = sql.replace(/\bUNSIGNED\b/gi, '');

    sql = sql.replace(/\bTINYINT\b/gi, 'SMALLINT');
    sql = sql.replace(/\bMEDIUMINT\b/gi, 'INTEGER');
    sql = sql.replace(/\bINT\s*\(\d+\)/gi, 'INTEGER');
    sql = sql.replace(/\bINT\b/gi, 'INTEGER');
    sql = sql.replace(/\bBIGINT\b/gi, 'BIGINT');

    sql = sql.replace(/\bDOUBLE\s+PRECISION\b/gi, 'DOUBLE PRECISION'); 
    sql = sql.replace(/\bDOUBLE\b/gi, 'DOUBLE PRECISION');
    sql = sql.replace(/\bFLOAT\b/gi, 'REAL');

    sql = sql.replace(/\b(?:TINY|MEDIUM|LONG)TEXT\b/gi, 'TEXT');
    sql = sql.replace(/\b(?:TINY|MEDIUM|LONG)?BLOB\b/gi, 'BYTEA');
    sql = sql.replace(/\bBINARY\b/gi, 'BYTEA');
    sql = sql.replace(/\bVARBINARY\b/gi, 'BYTEA');

    sql = sql.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
    sql = sql.replace(/\bJSON\b/gi, 'JSONB');

    // --- 3. DDL Transformations ---
    sql = sql.replace(/\bINTEGER\s+AUTO_INCREMENT\b/gi, 'SERIAL');
    sql = sql.replace(/\bBIGINT\s+AUTO_INCREMENT\b/gi, 'BIGSERIAL');
    sql = sql.replace(/\bAUTO_INCREMENT\b/gi, '');

    // Table Options Cleanup
    sql = sql.replace(/\)\s*(?:ENGINE|AUTO_INCREMENT|DEFAULT\s+CHARSET|CHARSET|COLLATE|ROW_FORMAT)[^;]*;/gi, ');');

    const lines = sql.split('\n');
    const processedLines = lines.map(line => {
      let l = line;
      if (l.match(/^\s*\)\s*(ENGINE|DEFAULT|CHARSET|COLLATE)/i)) {
         return ');'; 
      }
      return l;
    });
    sql = processedLines.join('\n');


    // --- 4. Functions & Operators ---
    sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
    sql = sql.replace(/\bSYSDATE\s*\(\)/gi, 'NOW()');
    sql = sql.replace(/\bCURDATE\s*\(\)/gi, 'CURRENT_DATE');
    sql = sql.replace(/\bNOW\s*\(\)/gi, 'NOW()'); 

    if (/\bGROUP_CONCAT\b/i.test(sql)) {
       notes.push('⚠️ GROUP_CONCAT detected. Converted to STRING_AGG, but check arguments (PG requires 2 args: expression, separator).');
       sql = sql.replace(/\bGROUP_CONCAT\s*\(/gi, "STRING_AGG("); 
    }

    // --- 5. DML Adjustments ---
    if (/\bINSERT\s+IGNORE\b/i.test(sql)) {
        notes.push('⚠️ INSERT IGNORE converted to INSERT. Manually add "ON CONFLICT DO NOTHING" based on your constraints.');
        sql = sql.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT');
    }

    if (/\bREPLACE\s+INTO\b/i.test(sql)) {
        notes.push('⚠️ REPLACE INTO converted to INSERT. Manually add "ON CONFLICT (...) DO UPDATE" logic.');
        sql = sql.replace(/\bREPLACE\s+INTO\b/gi, 'INSERT INTO');
    }

    const header = `-- ---------------------------------------------------------
-- SQL Migrator Enterprise (Script Engine)
-- Source: MySQL | Target: PostgreSQL
-- Timestamp: ${new Date().toISOString()}
-- ---------------------------------------------------------
`;
    
    const notesSection = notes.length > 0 
        ? `\n/* \n  [MIGRATION NOTES]\n  ${notes.join('\n  ')}\n*/\n\n`
        : '\n';

    return header + notesSection + sql;
  }

  // --- Analysis Logic ---

  analyzeSqlStructure(sql: string): TableDefinition[] {
    const tableMap = new Map<string, TableDefinition>();

    // 1. Find CREATE TABLE statements using Robust Parser
    // Simple regex for header start
    const createHeaderRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_$-]+)["`]?\s*\(/gi;
    let match;

    while ((match = createHeaderRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const startIdx = match.index;
      const bodyStart = startIdx + match[0].length;
      
      const bounds = this.findMatchingClosingParen(sql, bodyStart);
      if (!bounds) continue;

      const body = sql.substring(bodyStart, bounds.index); // content between ( ... )
      
      const columns: ColumnDefinition[] = [];
      const colDefs = this.splitByComma(body);

      for (const def of colDefs) {
        // Simple heuristic for column definitions
        // Match "colName Type" or "`colName` Type"
        const colRegex = /^["`]?([a-zA-Z0-9_$-]+)["`]?\s+([A-Z_]+)(?:\([^)]+\))?/i;
        const colMatch = def.trim().match(colRegex);
        
        // Exclude constraint lines like PRIMARY KEY (...), KEY (...), CONSTRAINT ...
        const isConstraint = /^(PRIMARY|KEY|CONSTRAINT|UNIQUE|FOREIGN|INDEX)/i.test(def.trim());

        if (colMatch && !isConstraint) {
          const colName = colMatch[1];
          const type = colMatch[2].toUpperCase();
          columns.push({ name: colName, type: type, sampleValues: [] });
        }
      }

      if (columns.length > 0) {
        tableMap.set(tableName, { name: tableName, columns });
      }
    }

    // 2. Scan for INSERT statements to populate or infer
    const insertHeaderRegex = /INSERT\s+(?:INTO\s+)?["`]?([a-zA-Z0-9_$-]+)["`]?\s*\(([^)]+)\)\s*VALUES\s*/gi;
    
    while ((match = insertHeaderRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const colNamesRaw = match[2];
      const valuesStartIndex = insertHeaderRegex.lastIndex;
      const valuesSubset = sql.substring(valuesStartIndex);
      const tupleInfo = this.extractFirstTuple(valuesSubset);
      if (!tupleInfo) continue;

      const colNames = colNamesRaw.split(',').map(s => s.trim().replace(/["`]/g, ''));
      const values = this.splitSqlValues(tupleInfo.content);

      let tableDef = tableMap.get(tableName);
      if (!tableDef) {
         tableDef = Array.from(tableMap.values()).find(t => t.name.toLowerCase() === tableName.toLowerCase());
      }

      // Infer table if missing
      if (!tableDef) {
         const inferredColumns: ColumnDefinition[] = [];
         colNames.forEach((colName, idx) => {
             inferredColumns.push({
               name: colName,
               type: 'UNKNOWN',
               sampleValues: []
             });
         });
         
         if (inferredColumns.length > 0) {
           tableDef = { name: tableName, columns: inferredColumns };
           tableMap.set(tableName, tableDef);
         }
      }

      // Add samples
      if (tableDef) {
        colNames.forEach((colName, index) => {
          const targetCol = tableDef!.columns.find(c => c.name.toLowerCase() === colName.toLowerCase());
          if (targetCol && values[index]) {
            const cleanVal = values[index].trim().replace(/^['"]|['"]$/g, '');
            if (!targetCol.sampleValues.includes(cleanVal) && targetCol.sampleValues.length < 5) {
              targetCol.sampleValues.push(cleanVal);
            }
          }
        });
      }
    }

    return Array.from(tableMap.values());
  }

  // --- Table Modification Logic ---

  modifyTable(sql: string, tableName: string, additions: ColumnAddition[], removals: string[]): string {
    let result = sql;

    // 1. ADD Columns
    // A. Add to CREATE TABLE
    if (additions.length > 0) {
        const createHeaderRegex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["\`]?${tableName}["\`]?\\s*\\(`, 'gi');
        
        let match;
        // We use a loop but likely there's only one CREATE per table. 
        // We need to use 'exec' to find index.
        // We process from end to start to maintain indices if there are multiple? 
        // Usually just one.
        if ((match = createHeaderRegex.exec(result)) !== null) {
            const startIdx = match.index;
            const bodyStart = startIdx + match[0].length;
            const bounds = this.findMatchingClosingParen(result, bodyStart);

            if (bounds) {
                const insertionPoint = bounds.index;
                const bodyBefore = result.substring(bodyStart, insertionPoint);
                
                // Construct new columns string
                const newColsSql = additions.map(col => {
                    let def = `  ${col.name} ${col.type}`;
                    if (col.defaultValue && col.defaultValue.trim()) {
                       const isLiteral = /^['"].*['"]$/.test(col.defaultValue) || /^\d+(\.\d+)?$/.test(col.defaultValue) || /^(TRUE|FALSE|NULL)$/i.test(col.defaultValue);
                       def += ` DEFAULT ${isLiteral ? col.defaultValue : `'${col.defaultValue}'`}`;
                    }
                    return def;
                }).join(',\n');

                let newBody = bodyBefore.trimEnd();
                // Ensure comma if not empty and not ending with comma
                if (newBody.length > 0 && !newBody.endsWith(',')) {
                    newBody += ',';
                }
                newBody += '\n' + newColsSql + '\n';
                
                result = result.substring(0, bodyStart) + newBody + result.substring(insertionPoint);
            }
        }

        // B. Add to INSERT statements
        // We need to find INSERTs for this table, add column to header, and value to tuples.
        const insertRegex = new RegExp(`(INSERT\\s+(?:INTO\\s+)?["\`]?${tableName}["\`]?\\s*\\(([^)]+)\\)\\s*VALUES\\s*)`, 'gi');
        
        // We'll reconstruct the whole SQL for inserts
        let newSql = '';
        let lastIdx = 0;
        let insMatch;
        
        while ((insMatch = insertRegex.exec(result)) !== null) {
            newSql += result.substring(lastIdx, insMatch.index);
            
            const header = insMatch[1];
            const colStr = insMatch[2];
            
            // 1. Modify Header
            const addedColNames = additions.map(a => a.name).join(', ');
            const newHeader = header.replace(`(${colStr})`, `(${colStr}, ${addedColNames})`);
            newSql += newHeader;

            // 2. Modify Values
            let currentIndex = insertRegex.lastIndex;
            let scanning = true;
            
            while (scanning) {
                // Parse tuple
                const tBounds = this.findNextTupleBounds(result, currentIndex);
                if (tBounds) {
                    newSql += result.substring(currentIndex, tBounds.start); // separators
                    
                    const tupleContent = result.substring(tBounds.start + 1, tBounds.end);
                    // Just append the default values
                    const addedValues = additions.map(a => {
                         if (!a.defaultValue) return 'NULL';
                         const isLiteral = /^['"].*['"]$/.test(a.defaultValue) || /^\d+(\.\d+)?$/.test(a.defaultValue) || /^(TRUE|FALSE|NULL)$/i.test(a.defaultValue);
                         return isLiteral ? a.defaultValue : `'${a.defaultValue}'`;
                    }).join(', ');
                    
                    newSql += `(${tupleContent}, ${addedValues})`;
                    
                    currentIndex = tBounds.end + 1;
                } else {
                    // Check if we hit a semicolon or EOF
                    const nextSemi = result.indexOf(';', currentIndex);
                    const insertNext = result.substring(currentIndex).search(/INSERT\s/i);
                    
                    // Logic: if we can't find a tuple, we just output the rest until statement end
                    let endOfStmt = -1;
                    if (nextSemi !== -1) endOfStmt = nextSemi + 1;
                    
                    if (endOfStmt !== -1) {
                         newSql += result.substring(currentIndex, endOfStmt);
                         currentIndex = endOfStmt;
                    } else {
                         newSql += result.substring(currentIndex);
                         currentIndex = result.length;
                    }
                    scanning = false;
                }
                
                if (currentIndex >= result.length) scanning = false;
            }
            lastIdx = currentIndex;
        }
        newSql += result.substring(lastIdx);
        result = newSql;
    }

    // 2. REMOVE Columns
    if (removals.length > 0) {
        const removalSet = new Set(removals.map(c => c.toLowerCase()));

        // A. Remove from CREATE TABLE
        const createHeaderRegex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["\`]?${tableName}["\`]?\\s*\\(`, 'gi');
        let match;
        if ((match = createHeaderRegex.exec(result)) !== null) {
             const startIdx = match.index;
             const bodyStart = startIdx + match[0].length;
             const bounds = this.findMatchingClosingParen(result, bodyStart);
             
             if (bounds) {
                 const body = result.substring(bodyStart, bounds.index);
                 const lines = body.split('\n');
                 const keptLines = lines.filter((line: string) => {
                     const trimmed = line.trim();
                     const colMatch = trimmed.match(/^["`]?([a-zA-Z0-9_$-]+)["`]?\s/);
                     if (colMatch && removalSet.has(colMatch[1].toLowerCase())) {
                         return false;
                     }
                     return true;
                 });
                 // Rejoin lines.
                 // This is simple line-based removal. A full AST would be better but this covers 99% of formatted SQL.
                 // We also need to fix comma on the new last line if it was removed
                 // But SQL allows trailing comma in some dialects, standard SQL does not.
                 // Let's strip trailing comma from the last kept line just in case
                 if (keptLines.length > 0) {
                     let lastIdx = keptLines.length - 1;
                     while(lastIdx >= 0 && keptLines[lastIdx].trim() === '') lastIdx--; // skip empty trailing lines
                     if (lastIdx >= 0) {
                         keptLines[lastIdx] = keptLines[lastIdx].replace(/,\s*$/, '');
                     }
                 }
                 
                 result = result.substring(0, bodyStart) + keptLines.join('\n') + result.substring(bounds.index);
             }
        }


        // B. Remove from INSERT INTO (Header + Values)
        const insertRegex = new RegExp(`(INSERT\\s+(?:INTO\\s+)?["\`]?${tableName}["\`]?\\s*\\(([^)]+)\\)\\s*VALUES\\s*)`, 'gi');
        
        let newResult = '';
        let lastIndex = 0;
        let matchMatch;

        while ((matchMatch = insertRegex.exec(result)) !== null) {
            newResult += result.substring(lastIndex, matchMatch.index);
            
            const header = matchMatch[1];
            const colStr = matchMatch[2];
            const cols = colStr.split(',').map(c => c.trim().replace(/[`"]/g, ''));
            
            // Identify indices to remove
            const indicesToRemove = new Set<number>();
            cols.forEach((c, i) => {
                if (removalSet.has(c.toLowerCase())) indicesToRemove.add(i);
            });

            // Reconstruct Header
            const newCols = cols.filter((_, i) => !indicesToRemove.has(i));
            const newHeader = header.replace(`(${colStr})`, `(${newCols.join(', ')})`);
            
            newResult += newHeader;

            // Process Values
            let currentIndex = insertRegex.lastIndex;
            let scanning = true;

            while(scanning) {
                const tBounds = this.findNextTupleBounds(result, currentIndex);
                if (tBounds) {
                    newResult += result.substring(currentIndex, tBounds.start); // separators
                    const tupleContent = result.substring(tBounds.start + 1, tBounds.end);
                    const values = this.splitSqlValues(tupleContent);
                    const newValues = values.filter((_, i) => !indicesToRemove.has(i));
                    newResult += `(${newValues.join(', ')})`;
                    currentIndex = tBounds.end + 1;
                } else {
                    const nextSemi = result.indexOf(';', currentIndex);
                    let endOfStmt = nextSemi !== -1 ? nextSemi + 1 : result.length;
                    
                    // Simple check if we hit next insert
                    const nextInsert = result.substring(currentIndex).search(/INSERT\s/i);
                    if (nextInsert !== -1 && (nextSemi === -1 || nextInsert < nextSemi)) {
                        endOfStmt = currentIndex + nextInsert;
                    }

                    newResult += result.substring(currentIndex, endOfStmt);
                    currentIndex = endOfStmt;
                    scanning = false;
                }
                if (currentIndex >= result.length) scanning = false;
            }
            lastIndex = currentIndex;
        }
        newResult += result.substring(lastIndex);
        result = newResult;
    }

    return result;
  }

  // --- Helpers ---

  private findMatchingClosingParen(str: string, startIndex: number): { index: number } | null {
      let depth = 1; // We assume startIndex is right after opening '('
      let inQuote = false;
      let quoteChar = '';

      for (let i = startIndex; i < str.length; i++) {
          const char = str[i];
          if (inQuote) {
              if (char === quoteChar && str[i-1] !== '\\') inQuote = false;
          } else {
              if (char === "'" || char === '"' || char === '`') {
                  inQuote = true;
                  quoteChar = char;
              } else if (char === '(') {
                  depth++;
              } else if (char === ')') {
                  depth--;
                  if (depth === 0) return { index: i };
              }
          }
      }
      return null;
  }

  private findNextTupleBounds(str: string, startIndex: number): { start: number, end: number } | null {
      // Look for next '(' that is not inside quotes, and ensure it's not a start of a new statement
      // Returns start index of '(' and end index of ')'
      let inQuote = false;
      let quoteChar = '';
      let tupleStart = -1;

      for (let i = startIndex; i < str.length; i++) {
          const char = str[i];
          if (inQuote) {
              if (char === quoteChar && str[i-1] !== '\\') inQuote = false;
          } else {
              if (char === "'" || char === '"' || char === '`') {
                  inQuote = true;
                  quoteChar = char;
              } else if (char === ';') {
                  return null; // Statement ended
              } else if (char === '(') {
                  // Found tuple start
                  tupleStart = i;
                  const endMatch = this.findMatchingClosingParen(str, i + 1);
                  if (endMatch) {
                      return { start: tupleStart, end: endMatch.index };
                  } else {
                      return null; // Malformed
                  }
              } else if (str.substring(i).match(/^INSERT\s/i)) {
                  return null; // New statement
              }
          }
      }
      return null;
  }

  private extractFirstTuple(str: string): { content: string, length: number } | null {
     const bounds = this.findNextTupleBounds(str, 0);
     if (bounds) {
         return { 
             content: str.substring(bounds.start + 1, bounds.end), 
             length: bounds.end + 1 
         };
     }
     return null;
  }

  private splitByComma(str: string): string[] {
    const parts: string[] = [];
    let current = '';
    let parenLevel = 0;
    let inQuote = false;
    let quoteChar = '';
    
    for (let i=0; i<str.length; i++) {
      const char = str[i];
      if (inQuote) {
        current += char;
        if (char === quoteChar && str[i-1] !== '\\') inQuote = false;
      } else {
        if (char === "'" || char === '"' || char === '`') {
          inQuote = true;
          quoteChar = char;
          current += char;
        } else if (char === '(') { parenLevel++; current += char; } 
        else if (char === ')') { parenLevel--; current += char; } 
        else if (char === ',' && parenLevel === 0) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private splitSqlValues(str: string): string[] {
    const res: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let parenLevel = 0;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (inQuote) {
        current += char;
        if (char === quoteChar && str[i-1] !== '\\') {
           if (char === "'" && str[i+1] === "'") { current += "'"; i++; } 
           else { inQuote = false; }
        }
      } else {
        if (char === "'" || char === '"' || char === '`') {
          inQuote = true;
          quoteChar = char;
          current += char;
        } else if (char === '(') { parenLevel++; current += char; } 
        else if (char === ')') { parenLevel--; current += char; } 
        else if (char === ',' && parenLevel === 0) {
          res.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    if (current.trim()) res.push(current.trim());
    else if (res.length === 0 && str.trim() === '') {}
    else res.push(current.trim());
    return res;
  }
  
  applyOffset(sql: string, tableName: string, columnOffsets: Map<string, number>): string {
    const columnsToOffset = Array.from(columnOffsets.keys());
    if (columnsToOffset.length === 0) return sql;

    const regex = new RegExp(`(INSERT\\s+(?:INTO\\s+)?["\`]?${tableName}["\`]?\\s*\\(([^)]+)\\)\\s*VALUES\\s*)`, 'gi');
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(sql)) !== null) {
      result += sql.substring(lastIndex, match.index);
      const header = match[1];
      const colStr = match[2];
      const cols = colStr.split(',').map(c => c.trim().replace(/[`"]/g, '').toLowerCase());
      
      const indexToOffset = new Map<number, number>();
      cols.forEach((col, idx) => {
        const configKey = columnsToOffset.find(k => k.toLowerCase() === col);
        if (configKey) {
          const amount = columnOffsets.get(configKey);
          if (amount !== undefined) indexToOffset.set(idx, amount);
        }
      });

      result += header;
      let currentIndex = regex.lastIndex;
      let scanning = true;
      while (scanning) {
        const tBounds = this.findNextTupleBounds(sql, currentIndex);
        if (tBounds) {
             result += sql.substring(currentIndex, tBounds.start);
             const tupleContent = sql.substring(tBounds.start + 1, tBounds.end);
             const values = this.splitSqlValues(tupleContent);
             
             indexToOffset.forEach((amount, idx) => {
                 if (values[idx]) {
                   const raw = values[idx].replace(/^['"]|['"]$/g, '');
                   if (/^-?\d+(\.\d+)?$/.test(raw)) {
                      const num = parseFloat(raw);
                      values[idx] = (num + amount).toString();
                   }
                 }
             });
             result += `(${values.join(', ')})`;
             currentIndex = tBounds.end + 1;
        } else {
            const nextSemi = sql.indexOf(';', currentIndex);
            let endOfStmt = nextSemi !== -1 ? nextSemi + 1 : sql.length;
            const nextInsert = sql.substring(currentIndex).search(/INSERT\s/i);
            if (nextInsert !== -1 && (nextSemi === -1 || nextInsert < nextSemi)) {
               endOfStmt = currentIndex + nextInsert;
            }
            result += sql.substring(currentIndex, endOfStmt);
            currentIndex = endOfStmt;
            scanning = false;
        }
        if (currentIndex >= sql.length) scanning = false;
      }
      lastIndex = currentIndex;
    }
    result += sql.substring(lastIndex);
    return result;
  }
}