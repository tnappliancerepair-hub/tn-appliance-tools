// Retrieves a single customer record by its ID.
query get_customer verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    db.get customer {
      field_name = "id"
      field_value = $input.customer_id
    } as $customer
  }

  response = $customer
  guid = "b2nrR4K3TKU0iH7yz3g8AmIXuLg"
}