# ServicePower sample offer emails — Phase A1 parser fixtures

Captured 2026-05-12 from `tnappliancerepair@gmail.com` via Gmail API for offline parser verification. One fixture per ServicePower email type observed in the 2026-05-12 landscape survey (see `docs/warranty-email-landscape-discovery-2026-05-12.md`).

**Redaction rules applied:**
- Customer names → `[FIRST] [LAST]`
- Phones → `[PHONE-10]`
- Addresses → `[STREET]` / `[CITY]` / `[ZIP]` (State kept — `TN` / `LA` are not PII)
- Emails → `[EMAIL]`
- **Kept as-is** (not PII): Model #, Serial #, dates, schedule periods, problem text, Call #, brand, product, source, all internal IDs

Gmail message IDs preserved for re-fetch if needed during parser development.

---

## Fixture 1 — service_request (DISPATCH_OFFER (post-accept confirmation))

**From:** `noreply@servicepower.com`  
**Subject:** `Service Request`  
**Collapsed pattern:** `Service Request`  
**Gmail message ID:** `19e1cc713f8a75d9`

**Body (plaintext, redacted):**

```
Servicepower Email Communication

 ServicePower

 Service and Installation Request

 Servicer Account TNA00001
 Call # 098894074139
 Source SQUARE TRADE
 Brand General Electric
 Product Washer
 Model # GTW485ASWWB
 Serial #
 Schedule Date 05/15/2026
 Schedule Period 8:00 - 10:00
 Call Taken 05/12/2026
 Call Type Service Contract
 ServiceType Rep
 Authority Number
 Co-Pay 0
 Contract #
 Install Date 05/11/2024
 Repeat Call NO
 Call Status Accepted
 Consumer Name [FIRST] [LAST]
 Consumer Address [STREET]
 City [CITY]
 State La
 Zip Code [ZIP]
 Home Phone [PHONE-10]
 Cell Phone
 Work Phone

 Customer Problem:
 MY TEAM WENT TO USE THE WASHER AND IT WILL START AND THEN SUDDENLY STOP

 Contact the consumer immediately to schedule or confirm the service
 appointment.

 To view all calls assigned to your business go to: http://www.servicepower.com
 (Click on the User Icon on the header right next to Request a Demo buttong then use your SERVICE P ower ID & Password to login)

 If you are unable to see the email properly, Click here.

 Do not reply to this email; it is unmonitored.
Notice: This communication may contain information that is legally privileged, confidential or exempt
from disclosure. If you are not the intended recipient, please note that any dissemination, distribution, or
copying of this document is strictly prohibited. Anyone who receives this message in error should
notify the sender immediately by telephone or by return e-mail and delete it from his or her computer.
Thank you.
```

---

## Fixture 2 — service_request_notice (DISPATCH_OFFER (pre-accept, requires response))

**From:** `noreply@servicepower.com`  
**Subject:** `Service Request Notice`  
**Collapsed pattern:** `Service Request Notice`  
**Gmail message ID:** `19e1c7d9f4238993`

**Body (plaintext, redacted):**

```
Servicepower Email Communication

 Service Request Offer

 Servicer Account TNA00001
 Call # 018815074130
 Source SQUARE TRADE
 Brand Whirlpool
 Product Wg Washing Machine
 Model # WTW5025SW
 Serial #
 Schedule Date 05/15/2026
 Schedule Period 10:00 - 12:00
 Call Taken 05/12/2026
 ServiceType Rep
 Co-Pay 0
 Contract #
 Install Date 01/27/2022
 Repeat Call NO
 Call Status Open
 Call Sub Status OPEN
 Consumer Name [FIRST] [LAST]
 Consumer Address [STREET]
 City [CITY]
 State Tn
 Zip Code [ZIP]
 Home Phone [PHONE-10]
 Cell Phone
 Work Phone
 Consumer Email [EMAIL]
 Network Attribute
 ClientCode I565
 Appointment completion form https://www.squaretrade.com/frontend/schedule-appointment/#/confirmappointment?confirmappointment=true&agent=technician&token=6bf99489-602f-4145-b0a6-aeb46d2e6dff

 The above product requires service. Click here to view Terms and Condition associated with this call.
 Please confirm your receipt of this Service Request Offer by clicking ACCEPT or REJECT.
 When you click either button, you should receive an immediate confirmation message in a pop up window and it should take you to Servicer portal

 Customer Problem:
 WHEN YOU PRESS START IT SOUNDS LIKE ITS GOING TO START RUNNING BUT THE LIGHT IMMEDIATELY GOES TO CYCLE COMPLETE AND THEN IT SHUTS OFF.

 After Acceptance, an email will follow with the complete details.
Upon receipt, please contact the consumer to schedule an appointment.
 Lack of a timely response will result in automatic reassignment of this call.

 NOTE: If the ACCEPT or REJECT buttons do not appear, please check your system security settings. Ensure Active X controls are enabled and pop up blocking software allows pop ups from our site
If you are unable to resolve this issue please go to fss.servicepower.com to accept.

 Web Site Instructions:
 User ID and Password are the same as your Claims ID and password
 Go to the New Calls tab. You will be able to accept or reject from that panel.
 To view all assigned calls, go to Incomplete Calls tab.
 You are also able to download your calls from that site.

 You may also call our help desk at [PHONE-10]. for further instructions and assistance.

 If you are unable to see the email properly, Click here.

 Do not reply to this email; it is unmonitored.
Notice: This communication may contain information that is legally privileged, confidential or exempt
from disclosure. If you are not the intended recipient, please note that any dissemination, distribution, or
copying of this document is strictly prohibited. Anyone who receives this message in error should
notify the sender immediately by telephone or by return e-mail and delete it from his or her computer.
Thank you.
```

---

## Fixture 3 — rescheduled_notice (SCHEDULE_CHANGE)

**From:** `noreply@servicepower.com`  
**Subject:** `Rescheduled Service Request Notice`  
**Collapsed pattern:** `Rescheduled Service Request Notice`  
**Gmail message ID:** `19e1c622cae198de`

**Body (plaintext, redacted):**

```
Servicepower Email Communication

 Service Request Offer

 THIS EMAIL HAS BEEN SENT TO YOU AS A NOTIFICATION THAT THE SERVICE HAS BEEN RESCHEDULED, PLEASE REVIEW & ACCEPT THE UPDATED CHANGES BELOW.

 Servicer Account TNA00001
 Call # 012116074134
 Source SQUARE TRADE
 Brand
 Product Wg Washing Machine
 Model # GFW655SPVDS
 Serial #
 Schedule Date 05/15/2026
 Schedule Period 13:00 - 15:00
 Call Taken 05/12/2026
 ServiceType Rep
 Co-Pay 0
 Contract #
 Install Date 12/15/2023
 Repeat Call NO
 Call Status Open
 Call Sub Status OPEN
 Consumer Name [FIRST] [LAST]
 Consumer Address [STREET]
 City [CITY]
 State Tn
 Zip Code [ZIP]
 Home Phone [PHONE-10]
 Cell Phone
 Work Phone
 Consumer Email [EMAIL]
 Network Attribute
 ClientCode I565
 Appointment completion form https://www.squaretrade.com/frontend/schedule-appointment/#/confirmappointment?confirmappointment=true&agent=technician&token=63fe6009-3636-4177-b169-3f6749bbfa7f

 The above product requires service. Click here to view Terms and Condition associated with this call.
 Please confirm your receipt of this Service Request Offer by clicking ACCEPT or REJECT.
 When you click either button, you should receive an immediate confirmation message in a pop up window and it should take you to Servicer portal

 Customer Problem:
 WASHER HAS A MECHANICAL/ELECTRICAL FAILURE DURING HOUSEHOLD USE. THE DOOR IS LOCKED AND WILL NOT RELEASE, DISPLAYS AN H2O RELATED ERROR CODE, AND ORDINARY TROUBLESHOOT AND MANUAL RELEASE HAVE NOT RESOLVED. WASHER IS UNUSABLE AND UNDER 5YR WARRANTY.

 After Acceptance, an email will follow with the complete details.
Upon receipt, please contact the consumer to schedule an appointment.
 Lack of a timely response will result in automatic reassignment of this call.

 NOTE: If the ACCEPT or REJECT buttons do not appear, please check your system security settings. Ensure Active X controls are enabled and pop up blocking software allows pop ups from our site
If you are unable to resolve this issue please go to fss.servicepower.com to accept.

 Web Site Instructions:
 User ID and Password are the same as your Claims ID and password
 Go to the New Calls tab. You will be able to accept or reject from that panel.
 To view all assigned calls, go to Incomplete Calls tab.
 You are also able to download your calls from that site.

 You may also call our help desk at [PHONE-10]. for further instructions and assistance.

 If you are unable to see the email properly, Click here.

 Do not reply to this email; it is unmonitored.
Notice: This communication may contain information that is legally privileged, confidential or exempt
from disclosure. If you are not the intended recipient, please note that any dissemination, distribution, or
copying of this document is strictly prohibited. Anyone who receives this message in error should
notify the sender immediately by telephone or by return e-mail and delete it from his or her computer.
Thank you.
```

---

## Fixture 4 — cancellation_notice (CANCELLATION)

**From:** `noreply@servicepower.com`  
**Subject:** `Service Request Notice Cancellation`  
**Collapsed pattern:** `Service Request Notice Cancellation`  
**Gmail message ID:** `19e174df7bb19b4f`

**Body (plaintext, redacted):**

```
Test Mail

 Service Request Notice Cancellation

 Source-Manufacturer id *SPPN-K100

 Call No 727146
 Product Home Cooking - Gas
 Brand Nxr
 Consumer First Name [FIRST]
 Consumer Last Name [LAST]
 Consumer Phone No [PHONE-10]
 Zip code 37064
 Date of call 05/11/2026
 Service on date 05/11/2026

 The above Service Request has been cancelled by consumer. If you are unable to see the email properly, Click here.

 Do not reply to this email; it is unmonitored.
Notice: This communication may contain information that is legally privileged, confidential or exempt
from disclosure. If you are not the intended recipient, please note that any dissemination, distribution, or
copying of this document is strictly prohibited. Anyone who receives thie message in error should
notify the sender immmediately by telephone or by return e-mail and delete it from his or her computer.
Thank you.
```

---

## Fixture 5 — new_notes (NOTES_ADDED)

**From:** `noreply@servicepower.com`  
**Subject:** `SERVICER NEW NOTES`  
**Collapsed pattern:** `{id} NEW NOTES`  
**Gmail message ID:** `19e1c7d4895b7409`

**Body (plaintext, redacted):**

```
Call Number: 018815074130


 Date Received: 05/12/2026 09:51:15 EST


 Notes Details: Diagnostic Truck Roll Repair date: 2026-05-15
Time Slot: 10-12

Customer''s Preferred Contact #: [PHONE-10]

Item Category: Consumer Electronics:Home & Garden:Major Household Appliances
Is stacked appliance? No
Manufacturer: Whirlpool
Model: WTW5025SW + w

Issue description: Pressure switch, Powers on but won''t start, Water inlet, Runs for a few minutes then stops
Pressure switch, Water inlet

Special instructions: Repair date & time have been verbally confirmed with the customer. Please go on repair appt date.
```

---

