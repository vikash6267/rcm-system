// Script to create a new user in the database
const crypto = require('crypto');
const { Database } = require('../lib/database');

async function createUser() {
  try {
    // User data
    const userData = {
      username: 'vikash',
      email: 'vikasmaheshwari6267@gmail.com',
      password: '12345678',
      first_name: 'Vikash',
      last_name: 'Maheshwari',
      role: 'ADMIN', // Default role
      department: 'MANAGEMENT' // Default department
    };

    // Check if user already exists
    const existingUser = await Database.findOne("users", { username: userData.username });
    if (existingUser) {
      console.log("User already exists with this username");
      return;
    }

    const existingEmail = await Database.findOne("users", { email: userData.email });
    if (existingEmail) {
      console.log("User already exists with this email");
      return;
    }

    // Create a simple hash for the password (for demonstration only)
    // In production, you should use bcrypt or another secure hashing algorithm
    const passwordHash = crypto.createHash('sha256').update(userData.password).digest('hex');

    // Create user
    const userId = await Database.create("users", {
      username: userData.username,
      email: userData.email,
      password_hash: passwordHash,
      first_name: userData.first_name,
      last_name: userData.last_name,
      role: userData.role,
      department: userData.department,
      is_active: true
    });

    console.log(`User created successfully with ID: ${userId}`);
  } catch (error) {
    console.error("Error creating user:", error);
  }
}

// Execute the function
createUser().then(() => {
  console.log("Script execution completed");
  process.exit(0);
}).catch(err => {
  console.error("Script execution failed:", err);
  process.exit(1);
});