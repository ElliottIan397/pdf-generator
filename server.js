const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

app.post("/generate-pdf", async (req, res) => {
  try {
    // Load and compile HTML template
    const templatePath = path.join(__dirname, "contract_template_minimal.html");
    const templateHtml = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateHtml);

    // Guardrail table formatting
    const data = req.body;
    const guardrails = [
      ["Fleet Output Avg. Mth. Lower Limit:", data.volumeLowerLimit],
      ["Fleet Output Avg. Mth. Upper Limit:", data.volumeUpperLimit],
      ["Device Lower Limit:", data.deviceLowerLimit],
      ["Device Upper Limit:", data.deviceUpperLimit],
    ];

    data.Guardrails_Table = guardrails.map(([label, value]) => `
      <tr>
        <td>${label}</td>
        <td>${value}</td>
      </tr>
    `).join("");

    // Generate HTML from data
    const html = template(data);

    // Send to html2pdf.app
    const response = await axios.post(
      "https://api.html2pdf.app/v1/generate",
      {
        html: html,
        apiKey: process.env.HTML2PDF_API_KEY,
      },
      { responseType: "arraybuffer" }
    );

    // Return PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=contract.pdf");
    res.send(response.data);
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).send("Failed to generate PDF.");
  }
});

const { getAccessToken } = require("./docusignClient");

app.post("/send-envelope", async (req, res) => {
  const contractData = req.body;

  if (!contractData.Customer_Email) {
    return res.status(400).json({ error: "Missing Customer_Email." });
  }

  try {
    const accessToken = await getAccessToken();

    // Simulate the PDF contract (you'll eventually generate this from html2pdf again)
    const pdfBuffer = fs.readFileSync(path.join(__dirname, "latest-contract.pdf")); // TEMP placeholder

    const envelopeDefinition = {
      emailSubject: "Please sign your Subscription Agreement",
      documents: [
        {
          documentBase64: pdfBuffer.toString("base64"),
          name: "Subscription_Agreement.pdf",
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: contractData.Customer_Email,
            name: contractData.Customer_Contact || "Customer",
            recipientId: "1",
            routingOrder: "1",
            tabs: {
              signHereTabs: [
                {
                  anchorString: "/sign_here/",
                  anchorUnits: "pixels",
                  anchorYOffset: "10",
                  anchorXOffset: "20",
                },
              ],
            },
          },
        ],
      },
      status: "sent",
    };

    const response = await axios.post(
      `${process.env.DOCUSIGN_BASE_PATH}/restapi/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`,
      envelopeDefinition,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({ envelopeId: response.data.envelopeId });
  } catch (err) {
    console.error("Envelope send error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send envelope." });
  }
});

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});
