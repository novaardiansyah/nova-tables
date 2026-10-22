import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PROJECT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(PROJECT, 'package.json'))
const sql = require('mssql')

const agents = fs.readFileSync(path.join(PROJECT, 'AGENTS.md'), 'utf8')
const match = agents.match(/User `sa`, password `([^`]+)`/)
if (!match) throw new Error('Local credential line not found')

const config = {
  server: 'localhost',
  port: 24350,
  user: 'sa',
  password: match[1],
  options: { encrypt: false, trustServerCertificate: true },
}

const admin = await new sql.ConnectionPool({ ...config, database: 'master' }).connect()
const databaseExists = await admin.request().query('SELECT DB_ID(N\'nova_tables_testing\') AS id')
if (!databaseExists.recordset[0].id) {
  await admin.request().query('CREATE DATABASE [nova_tables_testing]')
}
await admin.close()

const pool = await new sql.ConnectionPool({ ...config, database: 'nova_tables_testing' }).connect()

const reset = process.argv.includes('--reset')
const exists = await pool.request().query("SELECT OBJECT_ID(N'dbo.Customers', N'U') AS id")
if (exists.recordset[0].id) {
  if (!reset) {
    console.log('nova_tables_testing is already seeded; pass --reset to rebuild it.')
    await pool.close()
    process.exit(0)
  }

  await pool.request().query(`
    IF OBJECT_ID(N'dbo.usp_RestockProduct', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_RestockProduct;
    IF OBJECT_ID(N'dbo.usp_SalesByCategory', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_SalesByCategory;
    IF OBJECT_ID(N'dbo.usp_GetCustomerOrders', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_GetCustomerOrders;
    IF OBJECT_ID(N'dbo.fn_TopCustomers', N'IF') IS NOT NULL DROP FUNCTION dbo.fn_TopCustomers;
    IF OBJECT_ID(N'dbo.fn_CustomerLifetimeValue', N'FN') IS NOT NULL DROP FUNCTION dbo.fn_CustomerLifetimeValue;
    IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NOT NULL DROP TABLE dbo.OrderItems;
    IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL DROP TABLE dbo.Orders;
    IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL DROP TABLE dbo.Products;
    IF OBJECT_ID(N'dbo.Customers', N'U') IS NOT NULL DROP TABLE dbo.Customers;
  `)
}

await pool.request().query(`
  CREATE TABLE dbo.Customers (
    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    FullName nvarchar(120) NOT NULL,
    Email nvarchar(160) NOT NULL CONSTRAINT UQ_Customers_Email UNIQUE,
    City nvarchar(80) NOT NULL,
    Country nvarchar(80) NOT NULL,
    CreatedAt datetime2(0) NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT SYSUTCDATETIME()
  );

  CREATE TABLE dbo.Products (
    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Sku varchar(24) NOT NULL CONSTRAINT UQ_Products_Sku UNIQUE,
    Name nvarchar(120) NOT NULL,
    Category nvarchar(60) NOT NULL,
    Price decimal(18,2) NOT NULL CONSTRAINT CK_Products_Price CHECK (Price >= 0),
    Stock int NOT NULL CONSTRAINT DF_Products_Stock DEFAULT 0,
    IsActive bit NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT 1
  );

  CREATE TABLE dbo.Orders (
    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES dbo.Customers(Id),
    OrderDate datetime2(0) NOT NULL,
    Status varchar(20) NOT NULL,
    Total decimal(18,2) NOT NULL CONSTRAINT DF_Orders_Total DEFAULT 0,
    Notes nvarchar(240) NULL
  );

  CREATE INDEX IX_Orders_CustomerId ON dbo.Orders(CustomerId);
  CREATE INDEX IX_Orders_OrderDate ON dbo.Orders(OrderDate);

  CREATE TABLE dbo.OrderItems (
    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderItems PRIMARY KEY,
    OrderId int NOT NULL CONSTRAINT FK_OrderItems_Orders REFERENCES dbo.Orders(Id) ON DELETE CASCADE,
    ProductId int NOT NULL CONSTRAINT FK_OrderItems_Products REFERENCES dbo.Products(Id),
    Quantity int NOT NULL CONSTRAINT CK_OrderItems_Quantity CHECK (Quantity > 0),
    UnitPrice decimal(18,2) NOT NULL
  );

  CREATE INDEX IX_OrderItems_OrderId ON dbo.OrderItems(OrderId);
  CREATE INDEX IX_OrderItems_ProductId ON dbo.OrderItems(ProductId);
`)

await pool.request().query(`
  CREATE FUNCTION dbo.fn_CustomerLifetimeValue (@CustomerId int)
  RETURNS decimal(18,2)
  AS
  BEGIN
    DECLARE @total decimal(18,2)
    SELECT @total = ISNULL(SUM(o.Total), 0)
    FROM dbo.Orders o
    WHERE o.CustomerId = @CustomerId AND o.Status <> 'cancelled'
    RETURN @total
  END
`)

await pool.request().query(`
  CREATE FUNCTION dbo.fn_TopCustomers (@Count int)
  RETURNS TABLE
  AS
  RETURN
  (
    SELECT TOP (@Count)
      c.Id,
      c.FullName,
      c.Email,
      c.Country,
      CAST(ISNULL(SUM(CASE WHEN o.Status <> 'cancelled' THEN o.Total ELSE 0 END), 0) AS decimal(18,2)) AS LifetimeValue
    FROM dbo.Customers c
    LEFT JOIN dbo.Orders o ON o.CustomerId = c.Id
    GROUP BY c.Id, c.FullName, c.Email, c.Country
    ORDER BY LifetimeValue DESC
  )
`)

await pool.request().query(`
  CREATE PROCEDURE dbo.usp_GetCustomerOrders
    @CustomerId int
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT o.Id, o.OrderDate, o.Status, o.Total, COUNT(oi.Id) AS LineCount
    FROM dbo.Orders o
    LEFT JOIN dbo.OrderItems oi ON oi.OrderId = o.Id
    WHERE o.CustomerId = @CustomerId
    GROUP BY o.Id, o.OrderDate, o.Status, o.Total
    ORDER BY o.OrderDate DESC;
  END
`)

await pool.request().query(`
  CREATE PROCEDURE dbo.usp_SalesByCategory
    @FromDate datetime2 = NULL,
    @ToDate datetime2 = NULL
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT p.Category,
           SUM(oi.Quantity) AS UnitsSold,
           CAST(SUM(oi.Quantity * oi.UnitPrice) AS decimal(18,2)) AS Revenue
    FROM dbo.OrderItems oi
    JOIN dbo.Products p ON p.Id = oi.ProductId
    JOIN dbo.Orders o ON o.Id = oi.OrderId
    WHERE o.Status <> 'cancelled'
      AND (@FromDate IS NULL OR o.OrderDate >= @FromDate)
      AND (@ToDate IS NULL OR o.OrderDate < @ToDate)
    GROUP BY p.Category
    ORDER BY Revenue DESC;
  END
`)

await pool.request().query(`
  CREATE PROCEDURE dbo.usp_RestockProduct
    @ProductId int,
    @Quantity int
  AS
  BEGIN
    SET NOCOUNT ON;
    IF @Quantity <= 0 THROW 50001, 'Quantity must be greater than zero.', 1;
    UPDATE dbo.Products SET Stock = Stock + @Quantity WHERE Id = @ProductId;
    SELECT Id, Sku, Name, Stock FROM dbo.Products WHERE Id = @ProductId;
  END
`)

let seed = 20261023
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const pick = (items) => items[Math.floor(random() * items.length)]
const integer = (min, max) => min + Math.floor(random() * (max - min + 1))
const dateAgo = (days) => new Date(Date.now() - days * 86400000)

const firstNames = [
  'Alya', 'Bima', 'Citra', 'Damar', 'Eka', 'Farah', 'Gilang', 'Hana',
  'Irfan', 'Jihan', 'Krisna', 'Laras', 'Maya', 'Naufal', 'Olivia', 'Putra',
  'Qori', 'Raka', 'Sinta', 'Tegar', 'Umi', 'Vino', 'Wulan', 'Yoga',
]
const lastNames = [
  'Pratama', 'Saputra', 'Wijaya', 'Lestari', 'Nugroho', 'Maharani', 'Firmansyah', 'Kusuma',
  'Hidayat', 'Permata', 'Santoso', 'Anggraini', 'Ramadhan', 'Salsabila', 'Setiawan', 'Purnama',
]
const locations = [
  ['Jakarta', 'Indonesia'], ['Bandung', 'Indonesia'], ['Surabaya', 'Indonesia'],
  ['Yogyakarta', 'Indonesia'], ['Medan', 'Indonesia'], ['Makassar', 'Indonesia'],
  ['Denpasar', 'Indonesia'], ['Singapore', 'Singapore'], ['Kuala Lumpur', 'Malaysia'],
  ['Tokyo', 'Japan'],
]
const productSeeds = [
  ['SKU-LAP-001', 'Laptop Pro 14', 'Electronics', 1899],
  ['SKU-LAP-002', 'Laptop Air 13', 'Electronics', 1299],
  ['SKU-MON-001', 'UltraWide Monitor 34', 'Electronics', 749],
  ['SKU-KEY-001', 'Mechanical Keyboard', 'Accessories', 129],
  ['SKU-MOU-001', 'Wireless Mouse', 'Accessories', 39.9],
  ['SKU-HEA-001', 'Noise Cancelling Headphones', 'Audio', 279],
  ['SKU-HEA-002', 'Studio Earbuds', 'Audio', 149],
  ['SKU-CHA-001', 'Ergonomic Chair', 'Furniture', 529],
  ['SKU-DES-001', 'Standing Desk', 'Furniture', 799],
  ['SKU-LAM-001', 'Desk Lamp', 'Furniture', 59],
  ['SKU-BAG-001', 'Travel Backpack', 'Lifestyle', 119],
  ['SKU-BOT-001', 'Insulated Bottle', 'Lifestyle', 29],
  ['SKU-CAB-001', 'USB-C Hub', 'Accessories', 89],
  ['SKU-SSD-001', 'Portable SSD 1TB', 'Storage', 139],
  ['SKU-WEB-001', '4K Webcam', 'Electronics', 169],
  ['SKU-MIC-001', 'USB Microphone', 'Audio', 119],
]
const statuses = ['paid', 'paid', 'paid', 'shipped', 'shipped', 'pending', 'cancelled']
const notes = [null, null, null, 'Leave at reception', 'Gift wrap requested', 'Call before delivery']

const transaction = pool.transaction()
await transaction.begin()

try {
  const customers = []
  for (let index = 0; index < 24; index += 1) {
    const firstName = pick(firstNames)
    const lastName = pick(lastNames)
    const [city, country] = pick(locations)
    const result = await transaction
      .request()
      .input('fullName', sql.NVarChar(120), `${firstName} ${lastName}`)
      .input('email', sql.NVarChar(160), `${firstName}.${lastName}${index + 1}@example.com`.toLowerCase())
      .input('city', sql.NVarChar(80), city)
      .input('country', sql.NVarChar(80), country)
      .input('createdAt', sql.DateTime2, dateAgo(integer(20, 365)))
      .query(`
        INSERT INTO dbo.Customers (FullName, Email, City, Country, CreatedAt)
        OUTPUT INSERTED.Id AS id
        VALUES (@fullName, @email, @city, @country, @createdAt)
      `)
    customers.push(result.recordset[0].id)
  }

  const products = []
  for (const [sku, name, category, price] of productSeeds) {
    const result = await transaction
      .request()
      .input('sku', sql.VarChar(24), sku)
      .input('name', sql.NVarChar(120), name)
      .input('category', sql.NVarChar(60), category)
      .input('price', sql.Decimal(18, 2), price)
      .input('stock', sql.Int, integer(15, 180))
      .query(`
        INSERT INTO dbo.Products (Sku, Name, Category, Price, Stock)
        OUTPUT INSERTED.Id AS id
        VALUES (@sku, @name, @category, @price, @stock)
      `)
    products.push({ id: result.recordset[0].id, price })
  }

  for (let index = 0; index < 48; index += 1) {
    const customerId = pick(customers)
    const lineCount = integer(1, 4)
    const available = [...products]
    const items = []
    for (let line = 0; line < lineCount; line += 1) {
      const product = available.splice(Math.floor(random() * available.length), 1)[0]
      const quantity = integer(1, 3)
      items.push({ productId: product.id, quantity, unitPrice: product.price })
    }
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const order = await transaction
      .request()
      .input('customerId', sql.Int, customerId)
      .input('orderDate', sql.DateTime2, dateAgo(integer(0, 180)))
      .input('status', sql.VarChar(20), pick(statuses))
      .input('total', sql.Decimal(18, 2), total)
      .input('notes', sql.NVarChar(240), pick(notes))
      .query(`
        INSERT INTO dbo.Orders (CustomerId, OrderDate, Status, Total, Notes)
        OUTPUT INSERTED.Id AS id
        VALUES (@customerId, @orderDate, @status, @total, @notes)
      `)

    for (const item of items) {
      await transaction
        .request()
        .input('orderId', sql.Int, order.recordset[0].id)
        .input('productId', sql.Int, item.productId)
        .input('quantity', sql.Int, item.quantity)
        .input('unitPrice', sql.Decimal(18, 2), item.unitPrice)
        .query(`
          INSERT INTO dbo.OrderItems (OrderId, ProductId, Quantity, UnitPrice)
          VALUES (@orderId, @productId, @quantity, @unitPrice)
        `)
    }
  }

  await transaction.commit()
} catch (error) {
  await transaction.rollback()
  throw error
}

const summary = await pool.request().query(`
  SELECT (SELECT COUNT(*) FROM dbo.Customers) AS customers,
         (SELECT COUNT(*) FROM dbo.Products) AS products,
         (SELECT COUNT(*) FROM dbo.Orders) AS orders,
         (SELECT COUNT(*) FROM dbo.OrderItems) AS orderItems
`)

console.log('seeded nova_tables_testing')
console.log(summary.recordset[0])
await pool.close()
