// Seed initial cluster assignments
query seed_cluster_assignments verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    // Count existing records in cluster_assignment
    db.query cluster_assignment {
      return = {type: "count"}
    } as $assignment_count
  
    // Return early if records already exist
    conditional {
      if ($assignment_count > 0) {
        return {
          value = {
            success: false
            message: "Cluster assignments already seeded"
          }
        }
      }
    }
  
    // TN Northwest assignments
    db.add cluster_assignment {
      data = {
        cluster      : "TN Northwest"
        technician_id: 4
        rank         : 1
        active       : true
        notes        : "Primary — lives in area"
      }
    } as $tn_nw_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN Northwest"
        technician_id: 1
        rank         : 2
        active       : true
        notes        : "Backup coverage"
      }
    } as $tn_nw_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN Northwest"
        technician_id: 2
        rank         : 3
        active       : true
        notes        : "Overflow"
      }
    } as $tn_nw_3
  
    // TN Metro assignments
    db.add cluster_assignment {
      data = {
        cluster      : "TN Metro"
        technician_id: 1
        rank         : 1
        active       : true
        notes        : "Primary — Williamson focus"
      }
    } as $tn_m_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN Metro"
        technician_id: 4
        rank         : 2
        active       : true
        notes        : "Backup"
      }
    } as $tn_m_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN Metro"
        technician_id: 2
        rank         : 3
        active       : true
        notes        : "Overflow"
      }
    } as $tn_m_3
  
    // TN East assignments
    db.add cluster_assignment {
      data = {
        cluster      : "TN East"
        technician_id: 2
        rank         : 1
        active       : true
        notes        : "Primary — Sumner/Wilson/Rutherford/East Davidson"
      }
    } as $tn_e_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN East"
        technician_id: 1
        rank         : 2
        active       : true
        notes        : "Backup"
      }
    } as $tn_e_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "TN East"
        technician_id: 3
        rank         : 3
        active       : true
        notes        : "Historical coverage"
      }
    } as $tn_e_3
  
    // LA North assignments
    db.add cluster_assignment {
      data = {
        cluster      : "LA North"
        technician_id: 5
        rank         : 1
        active       : true
        notes        : "Primary — North Shore home"
      }
    } as $la_n_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA North"
        technician_id: 3
        rank         : 2
        active       : true
        notes        : "Backup"
      }
    } as $la_n_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA North"
        technician_id: 6
        rank         : 3
        active       : true
        notes        : "Overflow"
      }
    } as $la_n_3
  
    // LA West assignments
    db.add cluster_assignment {
      data = {
        cluster      : "LA West"
        technician_id: 6
        rank         : 1
        active       : true
        notes        : "Primary — Walker home, BR focus"
      }
    } as $la_w_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA West"
        technician_id: 5
        rank         : 2
        active       : true
        notes        : "Backup"
      }
    } as $la_w_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA West"
        technician_id: 3
        rank         : 3
        active       : true
        notes        : "Overflow"
      }
    } as $la_w_3
  
    // LA South assignments
    db.add cluster_assignment {
      data = {
        cluster      : "LA South"
        technician_id: 3
        rank         : 1
        active       : true
        notes        : "Primary — prefers South Shore"
      }
    } as $la_s_1
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA South"
        technician_id: 5
        rank         : 2
        active       : true
        notes        : "Backup — reluctant but covers"
      }
    } as $la_s_2
  
    db.add cluster_assignment {
      data = {
        cluster      : "LA South"
        technician_id: 6
        rank         : 3
        active       : true
        notes        : "Overflow"
      }
    } as $la_s_3
  }

  response = {success: true, records_inserted: 18}
  guid = "jGIUmwtmieBtBKPnOypcyn0eMiY"
}