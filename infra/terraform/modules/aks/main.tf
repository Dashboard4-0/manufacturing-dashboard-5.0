terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.95"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }
}

resource "azurerm_resource_group" "aks" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_kubernetes_cluster" "main" {
  name                = var.cluster_name
  location            = azurerm_resource_group.aks.location
  resource_group_name = azurerm_resource_group.aks.name
  dns_prefix          = var.dns_prefix
  kubernetes_version  = var.kubernetes_version

  default_node_pool {
    name                = "system"
    node_count          = var.system_node_count
    vm_size            = var.system_node_size
    os_disk_size_gb    = 100
    type               = "VirtualMachineScaleSets"
    enable_auto_scaling = true
    min_count          = var.system_min_count
    max_count          = var.system_max_count
    zones              = var.availability_zones

    node_labels = {
      "nodepool-type" = "system"
      "environment"   = var.environment
      "nodepoolmode"  = "system"
    }

    tags = var.tags
  }

  identity {
    type = "SystemAssigned"
  }

  addon_profile {
    oms_agent {
      enabled                    = true
      log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
    }

    azure_policy {
      enabled = true
    }

    ingress_application_gateway {
      enabled    = var.enable_app_gateway
      gateway_id = var.app_gateway_id
    }
  }

  network_profile {
    network_plugin     = "azure"
    network_policy     = "calico"
    dns_service_ip     = var.dns_service_ip
    docker_bridge_cidr = var.docker_bridge_cidr
    service_cidr       = var.service_cidr
    load_balancer_sku  = "standard"
  }

  role_based_access_control_enabled = true

  azure_active_directory_role_based_access_control {
    managed                = true
    admin_group_object_ids = var.admin_group_object_ids
    azure_rbac_enabled     = true
  }

  auto_scaler_profile {
    balance_similar_node_groups      = false
    expander                         = "random"
    max_graceful_termination_sec     = 600
    max_node_provisioning_time       = "15m"
    max_unready_nodes                = 3
    max_unready_percentage           = 45
    new_pod_scale_up_delay           = "0s"
    scale_down_delay_after_add       = "10m"
    scale_down_delay_after_delete    = "10s"
    scale_down_delay_after_failure   = "3m"
    scan_interval                    = "10s"
    scale_down_unneeded              = "10m"
    scale_down_unready               = "20m"
    scale_down_utilization_threshold = "0.5"
  }

  tags = var.tags
}

resource "azurerm_kubernetes_cluster_node_pool" "user" {
  for_each = var.node_pools

  name                  = each.key
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size              = each.value.vm_size
  node_count           = each.value.node_count
  enable_auto_scaling  = each.value.enable_auto_scaling
  min_count           = each.value.min_count
  max_count           = each.value.max_count
  os_disk_size_gb     = each.value.os_disk_size_gb
  zones               = var.availability_zones

  node_labels = merge(
    {
      "nodepool-type" = "user"
      "environment"   = var.environment
      "workload"      = each.key
    },
    each.value.node_labels
  )

  node_taints = each.value.node_taints

  tags = var.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.cluster_name}-logs"
  location            = azurerm_resource_group.aks.location
  resource_group_name = azurerm_resource_group.aks.name
  sku                = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags               = var.tags
}

resource "azurerm_monitor_diagnostic_setting" "aks" {
  name                       = "${var.cluster_name}-diagnostics"
  target_resource_id         = azurerm_kubernetes_cluster.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  log {
    category = "kube-apiserver"
    enabled  = true
  }

  log {
    category = "kube-controller-manager"
    enabled  = true
  }

  log {
    category = "kube-scheduler"
    enabled  = true
  }

  log {
    category = "kube-audit"
    enabled  = true
  }

  log {
    category = "cluster-autoscaler"
    enabled  = true
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

resource "azurerm_container_registry" "acr" {
  count               = var.create_acr ? 1 : 0
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.aks.name
  location            = azurerm_resource_group.aks.location
  sku                 = var.acr_sku
  admin_enabled       = false

  georeplications = var.acr_georeplications

  tags = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  count                = var.create_acr ? 1 : 0
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
  role_definition_name = "AcrPull"
  scope               = azurerm_container_registry.acr[0].id
}

resource "kubernetes_namespace" "ms5" {
  metadata {
    name = "ms5"
    labels = {
      name        = "ms5"
      environment = var.environment
    }
  }

  depends_on = [azurerm_kubernetes_cluster.main]
}

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
    labels = {
      name = "monitoring"
    }
  }

  depends_on = [azurerm_kubernetes_cluster.main]
}