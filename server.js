const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const axios = require("axios");
const { generateContract } = require("./generate_contract_pdf");
const { getAccessToken } = require("./docusignClient");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS setup
app.use(cors({
  origin: "*",
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/env-check", (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    DOCUSIGN_AUTH_SERVER: process.env.DOCUSIGN_AUTH_SERVER,
    DOCUSIGN_BASE_PATH: process.env.DOCUSIGN_BASE_PATH,
    DOCUSIGN_API_BASE_PATH: process.env.DOCUSIGN_API_BASE_PATH,
    DOCUSIGN_INTEGRATION_KEY: process.env.DOCUSIGN_INTEGRATION_KEY?.slice(0, 8) + '...',
    DOCUSIGN_USER_ID: process.env.DOCUSIGN_USER_ID?.slice(0, 8) + '...',
    DOCUSIGN_ACCOUNT_ID: process.env.DOCUSIGN_ACCOUNT_ID?.slice(0, 8) + '...',
  });
});

app.options("*", cors());

// ✅ JSON parser
app.use(bodyParser.json({ limit: "2mb" }));

// ✅ Logging helper
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ✅ PDF Generation Endpoint
app.post("/generate-pdf", async (req, res) => {
  try {
    const templatePath = path.join(__dirname, "contract_template_minimal.html");
    const templateHtml = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateHtml);

    const data = req.body;

    const guardrails = [
      ["Fleet Output Avg. Mth. Lower Limit:", data.volumeLowerLimit],
      ["Fleet Output Avg. Mth. Upper Limit:", data.volumeUpperLimit],
      ["Device Lower Limit:", data.deviceLowerLimit],
      ["Device Upper Limit:", data.deviceUpperLimit],
    ];

    data.Guardrails_Table = guardrails.map(([label, value]) => `
      <tr><td>${label}</td><td>${value}</td></tr>
    `).join("");

    const html = template(data);

    const response = await axios.post(
      "https://api.html2pdf.app/v1/generate",
      { html, apiKey: process.env.HTML2PDF_API_KEY },
      { responseType: "arraybuffer" }
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=contract.pdf");
    res.send(response.data);

  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});

// ✅ DocuSign Envelope Endpoint
app.post("/send-envelope", async (req, res) => {
  console.log("📥 /send-envelope endpoint hit");

  const contractData = req.body.contractData || req.body;

  if (!contractData.Customer_Email) {
    return res.status(400).json({ error: "Missing Customer_Email." });
  }

  try {
    const accessToken = await getAccessToken();
    const pdfBuffer = await generateContract(contractData);

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

    console.log("📤 Sending envelope to DocuSign...");

    console.log("📡 Posting to:", `${process.env.DOCUSIGN_BASE_PATH}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`);

    const response = await axios.post(
      `${process.env.DOCUSIGN_BASE_PATH}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`,
      envelopeDefinition,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Full DocuSign response:", response.data);
    res.status(200).json({ envelopeId: response.data.envelopeId });

  } catch (err) {
    console.error("❌ DocuSign send error:", err.response?.data || err.message);
    res.status(500).send("Failed to send to DocuSign");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 PDF service running on port ${PORT}`);
});
