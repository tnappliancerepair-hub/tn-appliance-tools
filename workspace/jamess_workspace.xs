// this workspace is the central decision and operations engine for managing appliance service workflows, from intake through diagnosis, parts ordering, tracking, and completion.
// Central operations engine for TN Appliance Exchange.
workspace "James's Workspace" {
  acceptance = {ai_terms: true}
  preferences = {
    internal_docs    : false
    track_performance: true
    sql_names        : false
    sql_columns      : true
  }
}