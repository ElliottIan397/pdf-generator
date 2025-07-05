const express = require("express");
const cors = require("cors"); // ✅ Add this line
const puppeteer = require("puppeteer");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // ✅ Add this line to enable CORS
app.use(bodyParser.json({ limit: "2mb" }));

app.post("/generate-pdf", async (req, res) => {
  const { fullName, address, email, contractDate, terms } = req.body;

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
    });
    const page = await browser.newPage();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            h1 { color: #333; }
            .section { margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <h1>Contract Agreement</h1>
          <div class="section">
            <strong>Full Name:</strong> ${fullName}<br />
            <strong>Address:</strong> ${address}<br />
            <strong>Email:</strong> ${email}<br />
            <strong>Date:</strong> ${contractDate}
          </div>
          <div class="section">
            <h2>Terms & Conditions</h2>
            <p>${terms}</p>
          </div>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4" });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=contract.pdf");
    res.send(pdf);
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).send("Failed to generate PDF.");
  }
});

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});
