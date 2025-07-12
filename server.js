const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const axios = require("axios");
const { generateContract } = require("./generate_contract_pdf");
const { getAccessToken } = require("./docusignClient");
const FormData = require("form-data");

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
  console.log("🧬 Scenario_URL received:", contractData.Scenario_URL);

  if (!contractData.Customer_Email) {
    return res.status(400).json({ error: "Missing Customer_Email." });
  }

  try {
    // ✅ HubSpot Integration: Search or Create Contact
    const hubspotApiToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const email = contractData.Customer_Email;
    let contactId;

    const searchResponse = await axios.post(
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      {
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: email
          }]
        }],
        properties: ["email"]
      },
      {
        headers: {
          Authorization: `Bearer ${hubspotApiToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const existingContact = searchResponse.data.results[0];

    if (existingContact) {
      contactId = existingContact.id;
      console.log(`✅ HubSpot: Contact already exists with ID ${contactId}`);
    } else {
      const createResponse = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/contacts",
        {
          properties: {
            email,
            firstname: contractData.Customer_Contact || "Customer"
          }
        },
        {
          headers: {
            Authorization: `Bearer ${hubspotApiToken}`,
            "Content-Type": "application/json"
          }
        }
      );
      contactId = createResponse.data.id;
      console.log("✅ HubSpot: New contact created with ID", contactId);
    }

    // 📝 Add note to HubSpot contact
    const noteText = `
Subscription Agreement sent to ${contractData.Customer_Contact || "Customer"} at ${email}.

Guardrails Summary:
- Fleet Output Avg. Mth. Lower Limit: ${contractData.volumeLowerLimit}
- Fleet Output Avg. Mth. Upper Limit: ${contractData.volumeUpperLimit}
- Device Lower Limit: ${contractData.deviceLowerLimit}
- Device Upper Limit: ${contractData.deviceUpperLimit}
`;
    await axios.post(
      "https://api.hubapi.com/engagements/v1/engagements",
      {
        engagement: { active: true, type: "NOTE" },
        associations: { contactIds: [contactId] },
        metadata: { body: noteText }
      },
      {
        headers: {
          Authorization: `Bearer ${hubspotApiToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`📝 HubSpot: Note added to contact ID ${contactId}`);

  } catch (err) {
    console.warn("⚠️ HubSpot error (non-blocking):", err.response?.data || err.message);
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
            email: contractData.Dealer_Email || "IanElliott@MidTennOP.com",
            name: contractData.Dealer_Name || "Dealer Signatory",
            recipientId: "1",
            routingOrder: "1", // ✅ Dealer signs first
            tabs: {
              signHereTabs: [
                {
                  anchorString: "/sign_here_dealer/",
                  anchorUnits: "pixels",
                  anchorYOffset: "10",
                  anchorXOffset: "20",
                },
              ],
            },
          },
          {
            email: contractData.Customer_Email,
            name: contractData.Customer_Contact || "Customer",
            recipientId: "2",
            routingOrder: "2", // ✅ Customer signs second
            tabs: {
              signHereTabs: [
                {
                  anchorString: "/sign_here_customer/",
                  anchorUnits: "pixels",
                  anchorYOffset: "10",
                  anchorXOffset: "20",
                },
              ],
            },
          },
        ],
      },
      // ✅ Inject hubspotEmail as a custom field
      customFields: {
        textCustomFields: [
          {
            name: "hubspotEmail",
            value: contractData.Customer_Email,
            required: false,
            show: false
          }
        ]
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

app.post("/docusign-webhook", async (req, res) => {
  console.log("📩 Webhook payload:", JSON.stringify(req.body, null, 2));

  try {
    const envelopeId = req.body?.data?.envelopeSummary?.envelopeId || req.body?.data?.envelopeId;
    const status = req.body?.data?.envelopeSummary?.status;

    console.log("📦 Envelope ID:", envelopeId);
    console.log("📌 Envelope Status:", status);

    if (status === "completed") {
      console.log("✅ DocuSign webhook: Envelope completed:", envelopeId);

      // 🔐 Get DocuSign access token
      const accessToken = await getAccessToken();

      // 📥 Fetch envelope custom fields to get hubspotEmail
      const customFieldResponse = await axios.get(
        `${process.env.DOCUSIGN_BASE_PATH}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/custom_fields`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const email = customFieldResponse.data?.textCustomFields?.find(
        f => f.name === "hubspotEmail"
      )?.value;

      if (!email) throw new Error("No hubspotEmail found in custom fields");

      const hubspotApiToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

      // 🔍 Search HubSpot contact by email
      const contactSearch = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/contacts/search",
        {
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
          properties: ["email"]
        },
        {
          headers: {
            Authorization: `Bearer ${hubspotApiToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      const contactId = contactSearch.data.results[0]?.id;
      if (!contactId) throw new Error(`No HubSpot contact found for ${email}`);

      // 📄 Download signed document from DocuSign
      const documentResponse = await axios.get(
        `${process.env.DOCUSIGN_BASE_PATH}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          responseType: "arraybuffer"
        }
      );

      const pdfBuffer = documentResponse.data;

      // 📤 Upload signed PDF to HubSpot
      const formData = new FormData();

      formData.append("file", pdfBuffer, {
        filename: "Signed_Agreement.pdf",
        contentType: "application/pdf"
      });

      formData.append("options", JSON.stringify({
        access: "PRIVATE",
        overwrite: false,
        folderId: "192547885421"
      }));

      formData.append("properties", JSON.stringify({
        name: "Signed Subscription Agreement"
      }));

      // ✅ DO NOT touch the formData after calling getHeaders
      const headers = {
        ...formData.getHeaders(),
        Authorization: `Bearer ${hubspotApiToken}`
      };

      const uploadResponse = await axios.post(
        "https://api.hubapi.com/files/v3/files",
        formData,
        { headers }
      );

      const fileId = uploadResponse.data.id;

      // 🔗 Associate file with HubSpot contact
      await axios.put(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/files/${fileId}/contact_to_file`,
        {},
        {
          headers: {
            Authorization: `Bearer ${hubspotApiToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("📎 Signed PDF associated with HubSpot contact", contactId);
    }

    res.status(200).send("Webhook received");
  } catch (err) {
    console.error("❌ Webhook processing failed:", err.response?.data || err.message || err);
    res.status(500).send("Webhook error");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 PDF service running on port ${PORT}`);
});
