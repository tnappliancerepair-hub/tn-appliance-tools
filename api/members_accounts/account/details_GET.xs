// See account details
query "account/details" verb=GET {
  api_group = "Members & Accounts"

  input {
    // Unique identifier for the account
    int account_id
  }

  stack {
    // Retrieve account details based on account ID
    db.get account {
      field_name = "id"
      field_value = $input.account_id
    } as $account_details
  }

  response = $account_details
  tags = ["xano:quick-start"]
  guid = "Crm3j2ow7eXHcghbXu4RZo3tcXA"
}