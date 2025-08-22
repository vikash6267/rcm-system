-- RCM (Revenue Cycle Management) Database Schema
-- HIPAA-compliant healthcare revenue cycle management system

-- Create database
CREATE DATABASE IF NOT EXISTS rcm_system;
USE rcm_system;

-- Enable strict mode for data integrity
SET sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION';

-- Patients table - Core patient demographics
CREATE TABLE patients (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    ssn_encrypted VARBINARY(255), -- Encrypted SSN for HIPAA compliance
    gender ENUM('M', 'F', 'O', 'U') NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    emergency_contact_name VARCHAR(200),
    emergency_contact_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    updated_by INT,
    INDEX idx_patient_id (patient_id),
    INDEX idx_name (last_name, first_name),
    INDEX idx_dob (date_of_birth)
);

-- Insurance providers table
CREATE TABLE insurance_providers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    payer_id VARCHAR(50) UNIQUE NOT NULL,
    payer_name VARCHAR(255) NOT NULL,
    payer_type ENUM('PRIMARY', 'SECONDARY', 'TERTIARY') NOT NULL,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    claims_address TEXT,
    electronic_payer_id VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Patient insurance table - Links patients to their insurance
CREATE TABLE patient_insurance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id INT NOT NULL,
    insurance_provider_id INT NOT NULL,
    policy_number_encrypted VARBINARY(255), -- Encrypted for HIPAA
    group_number VARCHAR(100),
    subscriber_id VARCHAR(100),
    subscriber_name VARCHAR(200),
    relationship_to_subscriber ENUM('SELF', 'SPOUSE', 'CHILD', 'OTHER') NOT NULL,
    effective_date DATE,
    termination_date DATE,
    copay_amount DECIMAL(10,2),
    deductible_amount DECIMAL(10,2),
    deductible_met_amount DECIMAL(10,2) DEFAULT 0.00,
    out_of_pocket_max DECIMAL(10,2),
    out_of_pocket_met DECIMAL(10,2) DEFAULT 0.00,
    priority ENUM('PRIMARY', 'SECONDARY', 'TERTIARY') NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (insurance_provider_id) REFERENCES insurance_providers(id),
    INDEX idx_patient_insurance (patient_id, priority)
);

-- Claims table - Core claims management
CREATE TABLE claims (
    id INT PRIMARY KEY AUTO_INCREMENT,
    claim_number VARCHAR(50) UNIQUE NOT NULL,
    patient_id INT NOT NULL,
    primary_insurance_id INT,
    secondary_insurance_id INT,
    provider_id INT,
    facility_id INT,
    claim_type ENUM('PROFESSIONAL', 'INSTITUTIONAL', 'DENTAL', 'VISION') NOT NULL,
    service_date_from DATE NOT NULL,
    service_date_to DATE NOT NULL,
    total_charges DECIMAL(12,2) NOT NULL,
    total_allowed DECIMAL(12,2) DEFAULT 0.00,
    total_paid DECIMAL(12,2) DEFAULT 0.00,
    patient_responsibility DECIMAL(12,2) DEFAULT 0.00,
    claim_status ENUM('DRAFT', 'READY', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'PAID', 'DENIED', 'APPEALED', 'CLOSED') DEFAULT 'DRAFT',
    submission_date DATETIME,
    clearinghouse_id VARCHAR(100),
    clearinghouse_status VARCHAR(50),
    primary_diagnosis_code VARCHAR(20),
    admission_date DATE,
    discharge_date DATE,
    place_of_service VARCHAR(10),
    billing_provider_npi VARCHAR(20),
    rendering_provider_npi VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    updated_by INT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (primary_insurance_id) REFERENCES patient_insurance(id),
    FOREIGN KEY (secondary_insurance_id) REFERENCES patient_insurance(id),
    INDEX idx_claim_number (claim_number),
    INDEX idx_patient_claims (patient_id),
    INDEX idx_claim_status (claim_status),
    INDEX idx_service_date (service_date_from, service_date_to),
    INDEX idx_submission_date (submission_date)
);

-- Claim line items - Individual services/procedures on claims
CREATE TABLE claim_line_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    claim_id INT NOT NULL,
    line_number INT NOT NULL,
    procedure_code VARCHAR(20) NOT NULL,
    modifier1 VARCHAR(5),
    modifier2 VARCHAR(5),
    modifier3 VARCHAR(5),
    modifier4 VARCHAR(5),
    diagnosis_code_1 VARCHAR(20),
    diagnosis_code_2 VARCHAR(20),
    diagnosis_code_3 VARCHAR(20),
    diagnosis_code_4 VARCHAR(20),
    service_date DATE NOT NULL,
    units INT DEFAULT 1,
    charge_amount DECIMAL(10,2) NOT NULL,
    allowed_amount DECIMAL(10,2) DEFAULT 0.00,
    paid_amount DECIMAL(10,2) DEFAULT 0.00,
    adjustment_amount DECIMAL(10,2) DEFAULT 0.00,
    patient_responsibility DECIMAL(10,2) DEFAULT 0.00,
    line_status ENUM('PENDING', 'PAID', 'DENIED', 'ADJUSTED') DEFAULT 'PENDING',
    place_of_service VARCHAR(10),
    rendering_provider_npi VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    INDEX idx_claim_lines (claim_id, line_number),
    INDEX idx_procedure_code (procedure_code),
    INDEX idx_service_date (service_date)
);

-- ERA (Electronic Remittance Advice) table
CREATE TABLE eras (
    id INT PRIMARY KEY AUTO_INCREMENT,
    era_number VARCHAR(50) UNIQUE NOT NULL,
    payer_id VARCHAR(50) NOT NULL,
    payer_name VARCHAR(255) NOT NULL,
    check_number VARCHAR(50),
    check_date DATE,
    check_amount DECIMAL(12,2),
    era_file_path VARCHAR(500),
    processing_status ENUM('RECEIVED', 'PROCESSING', 'POSTED', 'ERROR') DEFAULT 'RECEIVED',
    processed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_era_number (era_number),
    INDEX idx_payer (payer_id),
    INDEX idx_check_date (check_date)
);

-- ERA claim details - Links ERA to specific claims
CREATE TABLE era_claim_details (
    id INT PRIMARY KEY AUTO_INCREMENT,
    era_id INT NOT NULL,
    claim_id INT,
    claim_number VARCHAR(50) NOT NULL,
    patient_name VARCHAR(200),
    service_date_from DATE,
    service_date_to DATE,
    total_charge_amount DECIMAL(10,2),
    total_paid_amount DECIMAL(10,2),
    patient_responsibility DECIMAL(10,2),
    claim_status_code VARCHAR(10),
    claim_status_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (era_id) REFERENCES eras(id) ON DELETE CASCADE,
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    INDEX idx_era_claims (era_id),
    INDEX idx_claim_lookup (claim_number)
);

-- Payment postings table
CREATE TABLE payment_postings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    claim_id INT NOT NULL,
    era_id INT,
    payment_type ENUM('INSURANCE', 'PATIENT', 'ADJUSTMENT', 'REFUND') NOT NULL,
    payment_method ENUM('CHECK', 'EFT', 'CREDIT_CARD', 'CASH', 'ERA') NOT NULL,
    payment_amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    check_number VARCHAR(50),
    reference_number VARCHAR(100),
    payer_name VARCHAR(255),
    adjustment_reason_code VARCHAR(10),
    adjustment_reason_description TEXT,
    posted_by INT,
    posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    FOREIGN KEY (era_id) REFERENCES eras(id),
    INDEX idx_claim_payments (claim_id),
    INDEX idx_payment_date (payment_date),
    INDEX idx_payment_type (payment_type)
);

-- Denials table - Tracks denied claims and resolution workflow
CREATE TABLE denials (
    id INT PRIMARY KEY AUTO_INCREMENT,
    claim_id INT NOT NULL,
    denial_date DATE NOT NULL,
    denial_reason_code VARCHAR(20),
    denial_reason_description TEXT,
    denial_category ENUM('TECHNICAL', 'CLINICAL', 'AUTHORIZATION', 'ELIGIBILITY', 'DUPLICATE', 'OTHER') NOT NULL,
    priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') DEFAULT 'MEDIUM',
    assigned_to INT,
    resolution_status ENUM('OPEN', 'IN_PROGRESS', 'APPEALED', 'CORRECTED', 'WRITTEN_OFF', 'RESOLVED') DEFAULT 'OPEN',
    resolution_notes TEXT,
    resolution_date DATE,
    appeal_deadline DATE,
    follow_up_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    updated_by INT,
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    INDEX idx_claim_denials (claim_id),
    INDEX idx_denial_status (resolution_status),
    INDEX idx_assigned_to (assigned_to),
    INDEX idx_follow_up (follow_up_date)
);

-- Eligibility verification table
CREATE TABLE eligibility_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id INT NOT NULL,
    insurance_id INT NOT NULL,
    verification_date DATE NOT NULL,
    service_date DATE NOT NULL,
    verification_type ENUM('REAL_TIME', 'BATCH') NOT NULL,
    eligibility_status ENUM('ACTIVE', 'INACTIVE', 'TERMINATED', 'UNKNOWN') NOT NULL,
    benefits_active BOOLEAN DEFAULT FALSE,
    copay_amount DECIMAL(10,2),
    deductible_amount DECIMAL(10,2),
    deductible_remaining DECIMAL(10,2),
    out_of_pocket_max DECIMAL(10,2),
    out_of_pocket_remaining DECIMAL(10,2),
    coverage_level ENUM('INDIVIDUAL', 'FAMILY') DEFAULT 'INDIVIDUAL',
    plan_name VARCHAR(255),
    group_number VARCHAR(100),
    verification_response TEXT, -- Store full API response
    verified_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (insurance_id) REFERENCES patient_insurance(id),
    INDEX idx_patient_eligibility (patient_id, verification_date),
    INDEX idx_service_date (service_date)
);

-- Collections table - Patient collections management
CREATE TABLE collections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id INT NOT NULL,
    claim_id INT,
    collection_type ENUM('PATIENT_BALANCE', 'COPAY', 'DEDUCTIBLE', 'COINSURANCE') NOT NULL,
    original_amount DECIMAL(10,2) NOT NULL,
    current_balance DECIMAL(10,2) NOT NULL,
    collection_status ENUM('NEW', 'IN_PROGRESS', 'PAYMENT_PLAN', 'COLLECTIONS_AGENCY', 'WRITTEN_OFF', 'PAID') DEFAULT 'NEW',
    days_outstanding INT DEFAULT 0,
    last_statement_date DATE,
    last_contact_date DATE,
    next_action_date DATE,
    collection_notes TEXT,
    assigned_to INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    updated_by INT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (claim_id) REFERENCES claims(id),
    INDEX idx_patient_collections (patient_id),
    INDEX idx_collection_status (collection_status),
    INDEX idx_days_outstanding (days_outstanding),
    INDEX idx_next_action (next_action_date)
);

-- Payment plans table
CREATE TABLE payment_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id INT NOT NULL,
    collection_id INT,
    plan_amount DECIMAL(10,2) NOT NULL,
    monthly_payment DECIMAL(10,2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    payment_day_of_month INT DEFAULT 1,
    plan_status ENUM('ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED') DEFAULT 'ACTIVE',
    payments_made INT DEFAULT 0,
    total_payments INT NOT NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0.00,
    last_payment_date DATE,
    next_payment_date DATE,
    default_count INT DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (collection_id) REFERENCES collections(id),
    INDEX idx_patient_plans (patient_id),
    INDEX idx_plan_status (plan_status),
    INDEX idx_next_payment (next_payment_date)
);

-- Users table - System users for RBAC
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('ADMIN', 'MANAGER', 'BILLER', 'COLLECTOR', 'VIEWER') NOT NULL,
    department ENUM('BILLING', 'COLLECTIONS', 'MANAGEMENT', 'IT', 'CLINICAL') NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_login DATETIME,
    failed_login_attempts INT DEFAULT 0,
    account_locked_until DATETIME,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- Audit log table - HIPAA compliance logging
CREATE TABLE audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    patient_id INT, -- For PHI access tracking
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data JSON,
    response_status INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    session_id VARCHAR(255),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    INDEX idx_user_audit (user_id, timestamp),
    INDEX idx_patient_audit (patient_id, timestamp),
    INDEX idx_action (action),
    INDEX idx_timestamp (timestamp)
);

-- System settings table
CREATE TABLE system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('STRING', 'INTEGER', 'BOOLEAN', 'JSON') DEFAULT 'STRING',
    description TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE,
    updated_by INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, setting_type, description) VALUES
('claim_submission_enabled', 'true', 'BOOLEAN', 'Enable/disable claim submission to clearinghouse'),
('era_auto_posting_enabled', 'true', 'BOOLEAN', 'Enable automatic ERA posting'),
('patient_statement_cycle_days', '30', 'INTEGER', 'Days between patient statements'),
('collections_start_days', '90', 'INTEGER', 'Days before moving to collections'),
('denial_follow_up_days', '14', 'INTEGER', 'Default days for denial follow-up'),
('max_login_attempts', '5', 'INTEGER', 'Maximum failed login attempts before lockout'),
('session_timeout_minutes', '60', 'INTEGER', 'User session timeout in minutes');
