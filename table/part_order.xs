// Tracks parts needed for appliance repair jobs.
table part_order {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated job.
    int job_id?
  
    // Reference to the technician decision report.
    int technician_decision_report_id?
  
    // The part number needed.
    text part_number? filters=trim
  
    // Description of the part.
    text part_description? filters=trim
  
    // Name of the vendor for the part.
    text vendor_name? filters=trim
  
    // Order number from the vendor.
    text vendor_order_number? filters=trim
  
    // Cost of the part.
    decimal part_cost?
  
    // Selling price of the part.
    decimal part_sell_price?
  
    // Current status of the parts order (e.g., needs_order, ordered, shipped, delivered, backordered, canceled).
    text order_status? filters=trim
  
    // Tracking number for the parts shipment.
    text tracking_number? filters=trim
  
    // Estimated date of delivery for the part.
    date estimated_delivery_date?
  
    // Any additional notes about the parts order.
    text notes? filters=trim
  
    // Timestamp of the last update to the parts order record.
    timestamp updated_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "0STrrPc5YtzQC9nTuhpaaBiLEpw"
}