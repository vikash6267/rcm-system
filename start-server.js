// सर्वर स्टार्टअप स्क्रिप्ट
// path-to-regexp त्रुटि को हल करने के लिए

// DEBUG_URL को साफ करें
process.env.DEBUG_URL = "";

// सर्वर मॉड्यूल को आयात करें
require('./server.js');