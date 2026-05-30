# Enterprise SQL Converter

A powerful CSV to SQL converter application capable of handling large datasets with over 10,000 lines of CSV data efficiently.

## Features

- ✅ Convert CSV files to SQL INSERT statements
- ✅ Handle large CSV files (10,000+ lines)
- ✅ User-friendly web interface
- ✅ Real-time conversion preview
- ✅ Support for multiple data types
- ✅ Customizable table names and column mapping
- ✅ Export SQL queries directly

## Tech Stack

- **Frontend**: HTML, TypeScript
- **Backend**: Node.js/Express (if applicable)
- **Database**: SQL compatible databases

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager
- Modern web browser

### Installation

1. Clone the repository:
```bash
git clone https://github.com/jenushan04/Enterprise-SQL-Converter.git
cd Enterprise-SQL-Converter
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Upload CSV File**: Select your CSV file from your computer
2. **Configure Settings**: 
   - Set the table name
   - Map columns to appropriate data types
   - Configure any additional options
3. **Generate SQL**: Click the convert button to generate SQL statements
4. **Export**: Copy or download the generated SQL queries

### Example

**Input CSV:**
```
id,name,email,age
1,John Doe,john@example.com,28
2,Jane Smith,jane@example.com,34
```

**Output SQL:**
```sql
INSERT INTO users (id, name, email, age) VALUES (1, 'John Doe', 'john@example.com', 28);
INSERT INTO users (id, name, email, age) VALUES (2, 'Jane Smith', 'jane@example.com', 34);
```

## Limitations & Performance

- Maximum file size: Limited by browser memory
- Tested with CSV files containing 10,000+ lines
- Real-time processing for optimal user experience

## Project Structure

```
├── src/
│   ├── components/
│   ├── utils/
│   └── index.ts
├── public/
│   ├── index.html
│   └── styles.css
├── package.json
└── README.md
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues, questions, or suggestions, please open an issue on the [GitHub Issues](https://github.com/jenushan04/Enterprise-SQL-Converter/issues) page.

## Roadmap

- [ ] Support for additional SQL dialects (MySQL, PostgreSQL, SQL Server)
- [ ] Batch processing for multiple files
- [ ] Advanced data type detection
- [ ] Column validation rules
- [ ] Cloud storage integration

---

Made with ❤️ by [jenushan04](https://github.com/jenushan04)