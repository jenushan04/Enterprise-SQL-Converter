import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SqlConverterService, TableDefinition, ColumnAddition } from './services/sql-converter.service';

type ViewState = 'converter' | 'offset-tool' | 'column-manager';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  changeDetection: 1 // OnPush
})
export class AppComponent {
  private converterService = inject(SqlConverterService);

  // --- Navigation State ---
  currentView = signal<ViewState>('converter');

  // --- Converter View State ---
  mysqlInput = signal<string>('');
  pgOutput = signal<string>('');
  isLoading = signal<boolean>(false);
  
  isConvertDisabled = computed(() => 
    this.isLoading() || this.mysqlInput().trim().length === 0
  );

  // --- Offset Tool View State ---
  offsetInput = signal<string>('');
  offsetOutput = signal<string>('');
  detectedTables = signal<TableDefinition[]>([]);
  selectedColumnsMap = signal<Map<string, number>>(new Map());
  activeTableIndex = signal<number>(0);
  isAnalyzing = signal<boolean>(false);
  isProcessingOffset = signal<boolean>(false);
  showOffsetModal = signal<boolean>(false);

  // --- Column Manager View State ---
  colManInput = signal<string>('');
  colManOutput = signal<string>('');
  
  // Modal State for Column Manager
  showColManModal = signal<boolean>(false);
  colManTables = signal<TableDefinition[]>([]);
  colManActiveTableIdx = signal<number>(0);
  
  // Pending Changes
  colsToAdd = signal<ColumnAddition[]>([]);
  colsToRemove = signal<Set<string>>(new Set());

  // --- Navigation Methods ---
  setView(view: ViewState) {
    this.currentView.set(view);
  }

  // --- Converter Methods ---
  async convert() {
    if (this.isConvertDisabled()) return;

    this.isLoading.set(true);
    this.pgOutput.set('');

    try {
      const result = await this.converterService.convertSql(this.mysqlInput());
      this.pgOutput.set(result);
    } catch (err) {
      this.pgOutput.set('An unexpected error occurred. Please check console.');
    } finally {
      this.isLoading.set(false);
    }
  }

  clearConverter() {
    this.mysqlInput.set('');
    this.pgOutput.set('');
  }

  copyConverterOutput() {
    const text = this.pgOutput();
    if (text) navigator.clipboard.writeText(text);
  }

  loadConverterExample() {
    const example = `CREATE TABLE users (
  id INT(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active TINYINT(1) DEFAULT 1,
  data JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO users (username, data) VALUES ('alice', '{"role": "admin"}');`;
    this.mysqlInput.set(example);
  }

  // --- Offset Tool Methods ---

  async openOffsetTool() {
    if (!this.offsetInput().trim()) return;
    this.isAnalyzing.set(true);
    await new Promise(r => setTimeout(r, 400));
    const tables = this.converterService.analyzeSqlStructure(this.offsetInput());
    this.isAnalyzing.set(false);
    if (tables.length > 0) {
      this.detectedTables.set(tables);
      this.activeTableIndex.set(0);
      this.selectedColumnsMap.set(new Map()); 
      this.showOffsetModal.set(true);
    } else {
      alert("No suitable tables or INSERT statements found.");
    }
  }

  get currentTable() {
    const tables = this.detectedTables();
    if (!tables.length) return null;
    return tables[this.activeTableIndex()];
  }

  toggleColumn(colName: string, isChecked: boolean) {
    const table = this.currentTable;
    if (!table) return;
    const key = `${table.name}.${colName}`;
    this.selectedColumnsMap.update(map => {
      const newMap = new Map(map);
      if (isChecked) {
        if (!newMap.has(key)) newMap.set(key, 1000); 
      } else {
        newMap.delete(key);
      }
      return newMap;
    });
  }

  updateColumnOffset(colName: string, value: number) {
    const table = this.currentTable;
    if (!table) return;
    const key = `${table.name}.${colName}`;
    this.selectedColumnsMap.update(map => {
      const newMap = new Map(map);
      if (newMap.has(key)) newMap.set(key, value);
      return newMap;
    });
  }

  isColumnSelected(colName: string): boolean {
    const table = this.currentTable;
    if (!table) return false;
    return this.selectedColumnsMap().has(`${table.name}.${colName}`);
  }

  getColumnOffset(colName: string): number {
    const table = this.currentTable;
    if (!table) return 0;
    return this.selectedColumnsMap().get(`${table.name}.${colName}`) ?? 1000;
  }
  
  getSelectedCountForTable(tableName: string): number {
    let count = 0;
    for (const key of this.selectedColumnsMap().keys()) {
      if (key.startsWith(`${tableName}.`)) count++;
    }
    return count;
  }

  closeModal() {
    this.showOffsetModal.set(false);
  }

  async processOffset() {
    const tables = this.detectedTables();
    if (tables.length === 0 || this.selectedColumnsMap().size === 0) return;

    this.isProcessingOffset.set(true);
    this.showOffsetModal.set(false); 
    await new Promise(r => setTimeout(r, 400));
    let processedSql = this.offsetInput();
    const tableOffsets = new Map<string, Map<string, number>>();
    for (const [key, amount] of this.selectedColumnsMap().entries()) {
       const [tableName, colName] = key.split('.');
       if (!tableOffsets.has(tableName)) tableOffsets.set(tableName, new Map());
       tableOffsets.get(tableName)!.set(colName, amount);
    }
    for (const [tableName, colMap] of tableOffsets.entries()) {
      processedSql = this.converterService.applyOffset(processedSql, tableName, colMap);
    }
    this.offsetOutput.set(processedSql);
    this.isProcessingOffset.set(false);
  }

  clearOffsetTool() {
    this.offsetInput.set('');
    this.offsetOutput.set('');
    this.detectedTables.set([]);
    this.selectedColumnsMap.set(new Map());
  }

  copyOffsetOutput() {
    const text = this.offsetOutput();
    if (text) navigator.clipboard.writeText(text);
  }

  loadOffsetExample() {
    const example = `CREATE TABLE invoice (
  id INT PRIMARY KEY,
  invid VARCHAR(50),
  rfqid VARCHAR(50),
  term INT
);

INSERT INTO invoice (id, invid, rfqid, term) VALUES 
(2001, 'INV/AKIG/01', 'CONQ-001', 2),
(2002, 'INV/AKIG/02', 'CONQ-002', 2),
(2003, 'INV/AKIG/03', 'CONQ-003', 2),
(2004, 'INV/AKIG/04', 'CONQ-004', 2),
(2005, 'INV/AKIG/05', 'CONQ-005', 2);`;
    this.offsetInput.set(example);
  }

  // --- COLUMN MANAGER METHODS ---
  
  loadColManExample() {
    this.colManInput.set(`CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(50),
  last_name VARCHAR(50),
  email VARCHAR(100)
);

INSERT INTO employees (first_name, last_name, email) VALUES 
('John', 'Doe', 'john@example.com'),
('Jane', 'Smith', 'jane@example.com');`);
  }

  clearColMan() {
    this.colManInput.set('');
    this.colManOutput.set('');
  }

  copyColManOutput() {
    const text = this.colManOutput();
    if (text) navigator.clipboard.writeText(text);
  }

  async openColMan() {
     if (!this.colManInput().trim()) return;
     this.isAnalyzing.set(true);
     await new Promise(r => setTimeout(r, 400));
     const tables = this.converterService.analyzeSqlStructure(this.colManInput());
     this.isAnalyzing.set(false);
     
     if (tables.length > 0) {
       this.colManTables.set(tables);
       this.colManActiveTableIdx.set(0);
       // Reset pending changes
       this.colsToAdd.set([{ name: '', type: 'VARCHAR(255)', defaultValue: '' }]);
       this.colsToRemove.set(new Set());
       this.showColManModal.set(true);
     } else {
       alert("No tables found. Please check your SQL input.");
     }
  }

  get activeColManTable() {
    const tables = this.colManTables();
    if (!tables.length) return null;
    return tables[this.colManActiveTableIdx()];
  }

  closeColManModal() {
    this.showColManModal.set(false);
  }

  // Add Column Form Logic
  addEmptyColumn() {
    this.colsToAdd.update(cols => [...cols, { name: '', type: 'VARCHAR(255)', defaultValue: '' }]);
  }

  removeNewColumn(index: number) {
    this.colsToAdd.update(cols => cols.filter((_, i) => i !== index));
  }

  updateNewColumn(index: number, field: keyof ColumnAddition, value: string) {
    this.colsToAdd.update(cols => {
      const newCols = [...cols];
      newCols[index] = { ...newCols[index], [field]: value };
      return newCols;
    });
  }

  // Remove Column Logic
  toggleColRemoval(colName: string) {
    this.colsToRemove.update(set => {
      const newSet = new Set(set);
      if (newSet.has(colName)) newSet.delete(colName);
      else newSet.add(colName);
      return newSet;
    });
  }

  isColRemoved(colName: string): boolean {
    return this.colsToRemove().has(colName);
  }

  async applyColManChanges() {
     if (!this.activeColManTable) return;
     
     this.showColManModal.set(false);
     this.isAnalyzing.set(true);
     await new Promise(r => setTimeout(r, 600)); // processing simulation
     
     // Filter valid additions
     const additions = this.colsToAdd().filter(c => c.name.trim().length > 0);
     const removals = Array.from(this.colsToRemove());
     
     let sql = this.colManInput();
     sql = this.converterService.modifyTable(sql, this.activeColManTable!.name, additions, removals);
     
     this.colManOutput.set(sql);
     this.isAnalyzing.set(false);
  }

}