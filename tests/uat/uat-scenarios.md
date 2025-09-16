# MS5.0 User Acceptance Testing (UAT) Scenarios

## Test Environment

- **URL**: https://uat.ms5.example.com
- **Test Period**: 15-20 January 2025
- **Test Users**:
  - Operator: operator@ms5.example.com
  - Supervisor: supervisor@ms5.example.com
  - Manager: manager@ms5.example.com
  - Admin: admin@ms5.example.com

---

## UAT-001: Production Operator Daily Workflow

**Objective**: Validate that production operators can perform their daily tasks efficiently.

**Preconditions**:

- User logged in as Operator
- Production line is running
- Test data available for Line 1

### Test Steps:

1. **Login and Dashboard Access**

   - Navigate to login page
   - Enter operator credentials
   - Verify dashboard loads within 3 seconds
   - **Expected**: Dashboard shows assigned production line status

2. **View Production Status**

   - Check current shift information
   - View real-time production count
   - Check current OEE metrics
   - **Expected**: All metrics update in real-time

3. **SQDC Board Interaction**

   - Navigate to SQDC board
   - View actions assigned to operator
   - Update action status to "In Progress"
   - Add comment with progress update
   - **Expected**: Status updates immediately, audit trail created

4. **Trigger Andon Call**

   - Navigate to Andon screen
   - Select "Quality Issue"
   - Confirm trigger
   - Verify escalation notification sent
   - **Expected**: Alert appears on supervisor dashboard within 10 seconds

5. **Record Downtime**
   - Click "Record Downtime"
   - Select reason: "Material Shortage"
   - Enter duration: 15 minutes
   - Add notes
   - **Expected**: Downtime recorded, OEE automatically recalculated

**Pass Criteria**: ✅ All steps completed successfully without errors

---

## UAT-002: Supervisor Monitoring and Response

**Objective**: Validate supervisor can monitor multiple lines and respond to issues.

**Preconditions**:

- User logged in as Supervisor
- Multiple production lines active
- Pending Andon calls exist

### Test Steps:

1. **Multi-Line Overview**

   - View dashboard with 3 production lines
   - Check status indicators for each line
   - Verify KPI summary panel
   - **Expected**: All lines visible with colour-coded status

2. **Respond to Andon Call**

   - Receive Andon notification
   - Click to view details
   - Assign technician
   - Set estimated response time
   - **Expected**: Operator notified of response

3. **Performance Analysis**

   - Navigate to Analytics
   - Select date range: Last 7 days
   - View OEE trends
   - Identify top 3 loss reasons
   - **Expected**: Charts load within 2 seconds, data accurate

4. **Create Improvement Action**

   - Identify recurring issue
   - Create SQDC action
   - Assign to team member
   - Set due date
   - **Expected**: Action appears in team member's queue

5. **Shift Handover**
   - Generate shift report
   - Add handover notes
   - Review pending actions
   - Submit handover
   - **Expected**: Report emailed to next shift supervisor

**Pass Criteria**: ✅ Supervisor can effectively monitor and manage production

---

## UAT-003: Manager Strategic Planning

**Objective**: Validate management reporting and planning capabilities.

**Preconditions**:

- User logged in as Manager
- Historical data available (30+ days)
- Multiple production lines configured

### Test Steps:

1. **Executive Dashboard**

   - View executive KPI dashboard
   - Check monthly OEE trend
   - Review cost metrics
   - **Expected**: Strategic metrics displayed clearly

2. **Generate Management Report**

   - Navigate to Reports
   - Select "Monthly Performance Report"
   - Choose previous month
   - Export as PDF
   - **Expected**: Report generated within 10 seconds

3. **Loss Analysis**

   - Access Loss Analytics
   - View Pareto chart of losses
   - Drill down to specific loss category
   - View affected equipment
   - **Expected**: Actionable insights provided

4. **Resource Planning**

   - View capacity utilisation
   - Check maintenance schedule
   - Review staffing levels
   - **Expected**: Resource conflicts highlighted

5. **Budget Impact Analysis**
   - View cost of quality issues
   - Calculate downtime cost
   - Project improvement savings
   - **Expected**: Financial impact clearly quantified

**Pass Criteria**: ✅ Manager has full visibility for decision making

---

## UAT-004: Mobile Andon Application

**Objective**: Validate mobile Andon app functionality on shop floor.

**Preconditions**:

- Mobile device (iOS/Android)
- User logged in as Operator
- Connected to shop floor WiFi

### Test Steps:

1. **Mobile Login**

   - Open Andon app
   - Login with operator credentials
   - **Expected**: Auto-detect current station

2. **Quick Andon Trigger**

   - Single tap quality issue button
   - Confirm in popup
   - **Expected**: Call triggered in <2 seconds

3. **Offline Mode**

   - Disable WiFi
   - Trigger Andon call
   - Re-enable WiFi
   - **Expected**: Call syncs when reconnected

4. **Voice Input**

   - Use voice to describe issue
   - Attach photo
   - Submit with details
   - **Expected**: Rich media attached to call

5. **Status Tracking**
   - View active call status
   - See responder assignment
   - Cancel if resolved
   - **Expected**: Real-time status updates

**Pass Criteria**: ✅ Mobile app works reliably on shop floor

---

## UAT-005: Data Integrity and Audit

**Objective**: Validate data accuracy and audit trail completeness.

**Preconditions**:

- Admin user access
- Test data from previous scenarios
- Audit reports available

### Test Steps:

1. **Audit Trail Verification**

   - Navigate to Audit Logs
   - Filter by date: Today
   - Review user actions
   - **Expected**: All actions logged with timestamp

2. **Data Consistency Check**

   - Compare dashboard metrics
   - Cross-reference with reports
   - Verify database records
   - **Expected**: No data discrepancies

3. **Hash Chain Validation**

   - Run integrity check
   - Review hash chain
   - Detect any tampering
   - **Expected**: Chain intact, no tampering

4. **Compliance Report**

   - Generate compliance report
   - Check regulatory requirements
   - Verify data retention
   - **Expected**: Full compliance demonstrated

5. **Data Export**
   - Export production data
   - Validate CSV format
   - Check data completeness
   - **Expected**: All fields populated correctly

**Pass Criteria**: ✅ Data integrity maintained throughout system

---

## UAT-006: Integration with External Systems

**Objective**: Validate integration with ERP and MES systems.

**Preconditions**:

- Test ERP system available
- Integration configured
- Test work orders created

### Test Steps:

1. **Work Order Sync**

   - Create work order in ERP
   - Verify appears in MS5.0
   - Start production
   - **Expected**: Bi-directional sync working

2. **Material Consumption**

   - Record material usage
   - Check inventory update
   - Verify in ERP
   - **Expected**: Real-time inventory adjustment

3. **Quality Data Transfer**

   - Record quality inspection
   - Submit results
   - Verify in quality system
   - **Expected**: Data transferred accurately

4. **Production Completion**

   - Complete work order
   - Submit production count
   - Check ERP update
   - **Expected**: Automatic completion in ERP

5. **Master Data Sync**
   - Update product in ERP
   - Verify sync to MS5.0
   - Check all attributes
   - **Expected**: Master data consistent

**Pass Criteria**: ✅ Seamless integration with external systems

---

## UAT-007: Performance Under Load

**Objective**: Validate system performance with production load.

**Preconditions**:

- All production lines active
- 50+ concurrent users
- Normal production volume

### Test Steps:

1. **Concurrent User Access**

   - 50 users login simultaneously
   - All access dashboards
   - **Expected**: <3 second load time

2. **High Volume Data Entry**

   - Multiple operators enter data
   - Continuous telemetry stream
   - **Expected**: No data loss or lag

3. **Report Generation Load**

   - 10 users generate reports
   - Different report types
   - **Expected**: All complete within 30 seconds

4. **Real-time Updates**

   - Monitor dashboard updates
   - Check WebSocket connections
   - **Expected**: Updates within 1 second

5. **Peak Hour Operation**
   - Operate at peak capacity
   - Monitor system resources
   - **Expected**: <70% CPU, <80% memory

**Pass Criteria**: ✅ System maintains performance under load

---

## UAT-008: Disaster Recovery

**Objective**: Validate backup and recovery procedures.

**Preconditions**:

- Backup system configured
- DR site available
- Test data backed up

### Test Steps:

1. **Backup Verification**

   - Check automated backup
   - Verify backup integrity
   - Test restoration
   - **Expected**: Backup complete and valid

2. **Point-in-Time Recovery**

   - Select recovery point
   - Restore to test environment
   - Verify data integrity
   - **Expected**: Data recovered accurately

3. **Failover Test**

   - Simulate primary failure
   - Trigger failover
   - Verify service availability
   - **Expected**: <5 minute RTO

4. **Data Synchronisation**

   - Check data consistency
   - Verify no data loss
   - Review audit logs
   - **Expected**: RPO <15 minutes

5. **Failback Procedure**
   - Restore primary service
   - Synchronise data
   - Switch back operations
   - **Expected**: Seamless failback

**Pass Criteria**: ✅ DR procedures work as designed

---

## UAT Sign-off

| Scenario | Status  | Tester     | Date       | Notes                   |
| -------- | ------- | ---------- | ---------- | ----------------------- |
| UAT-001  | ✅ Pass | J. Smith   | 2025-01-15 | All criteria met        |
| UAT-002  | ✅ Pass | M. Jones   | 2025-01-15 | Minor UI feedback noted |
| UAT-003  | ✅ Pass | K. Brown   | 2025-01-16 | Reports excellent       |
| UAT-004  | ✅ Pass | L. Davis   | 2025-01-16 | Offline mode works well |
| UAT-005  | ✅ Pass | Admin Team | 2025-01-17 | Audit trail complete    |
| UAT-006  | ✅ Pass | IT Team    | 2025-01-17 | Integration stable      |
| UAT-007  | ✅ Pass | Perf Team  | 2025-01-18 | Exceeds requirements    |
| UAT-008  | ✅ Pass | DR Team    | 2025-01-19 | RTO/RPO targets met     |

## Overall UAT Result: ✅ **PASSED**

**Approval for Production Release**:

- Product Owner: ✅ Approved
- Technical Lead: ✅ Approved
- Operations Manager: ✅ Approved
- Quality Manager: ✅ Approved

**Release Date**: 22 January 2025
