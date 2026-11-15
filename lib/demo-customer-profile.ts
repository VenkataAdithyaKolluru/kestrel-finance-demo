import type { DemoCustomerProfile } from "./types";

const demoContacts = [
  "Ananya Mehta",
  "Rohan Khanna",
  "Ishita Rao",
  "Dev Malhotra",
  "Kavya Iyer",
  "Arjun Desai",
  "Nisha Kapoor",
  "Vikram Shah",
  "Mira Nair",
  "Kabir Sethi",
  "Tara Menon",
];

const demoAddresses = [
  "Plot 14, Phase II, Industrial Area, Bengaluru, Karnataka 560058",
  "Unit 8, Textile Park, Panipat, Haryana 132103",
  "Building C, Food Processing Zone, Pune, Maharashtra 411019",
  "Office 402, Tech Park, Hyderabad, Telangana 500081",
  "Shed 12, Packaging Estate, Ahmedabad, Gujarat 382213",
  "Suite 6, Trade Centre, Jaipur, Rajasthan 302013",
  "Plot 31, MIDC, Nashik, Maharashtra 422010",
  "Block A, Logistics Park, Chennai, Tamil Nadu 600096",
  "Unit 5, Medical Devices Park, Kochi, Kerala 683503",
  "Office 207, Export House, Surat, Gujarat 395007",
  "Plot 19, Auto Cluster, Pune, Maharashtra 411026",
];

function stableIndex(applicationId: string): number {
  let hash = 0;
  for (const character of applicationId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % demoContacts.length;
}

export function createDemoCustomerProfile(
  applicationId: string,
  applicantName: string,
): DemoCustomerProfile {
  const index = stableIndex(applicationId);
  const slug = applicantName
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited)\b/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48);

  return {
    contactName: demoContacts[index],
    email: `${slug || "customer"}+${applicationId.toLowerCase()}@demo.kestrelfinance.test`,
    businessAddress: demoAddresses[index],
    promoterName: demoContacts[(index + 4) % demoContacts.length],
  };
}

export function createDemoBureauScore(applicationId: string): number {
  let hash = 0;
  for (const character of applicationId) {
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  }
  return 620 + (hash % 231);
}
