#!/bin/bash
set -euo pipefail

echo "🚀 NVIDIA Jetson Orin NX Setup for MS5.0"
echo "========================================="

# Check if running on Jetson
if [ ! -f /etc/nv_tegra_release ]; then
  echo "⚠️ Warning: This script is designed for NVIDIA Jetson devices"
  echo "Continue anyway? (y/n)"
  read -r response
  if [ "$response" != "y" ]; then
    exit 1
  fi
fi

# System information
echo ""
echo "📊 System Information:"
echo "----------------------"
uname -a
if [ -f /etc/nv_tegra_release ]; then
  cat /etc/nv_tegra_release
fi
echo "Architecture: $(uname -m)"
echo "Memory: $(free -h | grep Mem | awk '{print $2}')"
echo "Storage: $(df -h / | tail -1 | awk '{print $4}' ) available"

# Update system
echo ""
echo "📦 Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install dependencies
echo ""
echo "🔧 Installing dependencies..."
sudo apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  python3-pip \
  python3-dev \
  libssl-dev \
  libffi-dev \
  postgresql-client \
  jq \
  htop \
  iotop \
  nano

# Install Docker (if not present)
if ! command -v docker &> /dev/null; then
  echo ""
  echo "🐳 Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo usermod -aG docker $USER
  rm get-docker.sh
else
  echo "✅ Docker already installed: $(docker --version)"
fi

# Install K3s
echo ""
echo "☸️ Installing K3s..."

# K3s installation with specific options for Jetson
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --docker \
  --disable traefik \
  --disable metrics-server \
  --kubelet-arg='max-pods=50' \
  --kubelet-arg='eviction-hard=memory.available<500Mi' \
  --kubelet-arg='system-reserved=memory=1Gi' \
  --kube-apiserver-arg='max-requests-inflight=100' \
  --kube-apiserver-arg='max-mutating-requests-inflight=50'" sh -

# Wait for K3s to be ready
echo "⏳ Waiting for K3s to be ready..."
sudo k3s kubectl wait --for=condition=Ready node --all --timeout=300s

# Setup kubectl
echo ""
echo "🔧 Setting up kubectl..."
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config
export KUBECONFIG=~/.kube/config

# Install Helm
if ! command -v helm &> /dev/null; then
  echo ""
  echo "⎈ Installing Helm..."
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
else
  echo "✅ Helm already installed: $(helm version --short)"
fi

# Create MS5 namespace
echo ""
echo "📁 Creating MS5 namespace..."
kubectl create namespace ms5 --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace ms5-edge --dry-run=client -o yaml | kubectl apply -f -

# Install NVIDIA device plugin
echo ""
echo "🎮 Installing NVIDIA device plugin..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nvidia-device-plugin-daemonset
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: nvidia-device-plugin-ds
  template:
    metadata:
      labels:
        name: nvidia-device-plugin-ds
    spec:
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
      priorityClassName: system-node-critical
      containers:
      - image: nvcr.io/nvidia/k8s-device-plugin:v0.14.0
        name: nvidia-device-plugin-ctr
        env:
        - name: FAIL_ON_INIT_ERROR
          value: "false"
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: device-plugin
          mountPath: /var/lib/kubelet/device-plugins
      volumes:
      - name: device-plugin
        hostPath:
          path: /var/lib/kubelet/device-plugins
EOF

# Create RuntimeClass for NVIDIA
echo ""
echo "🏃 Creating RuntimeClass for NVIDIA..."
kubectl apply -f infra/k8s/runtimeclass-nvidia.yaml

# Configure storage class for edge
echo ""
echo "💾 Configuring storage..."
cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
EOF

# Setup local MinIO for edge storage
echo ""
echo "🗂️ Setting up MinIO for edge storage..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Namespace
metadata:
  name: minio
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio
  namespace: minio
spec:
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
      - name: minio
        image: minio/minio:RELEASE.2024-03-10T02-53-48Z
        args:
        - server
        - /data
        - --console-address
        - ":9001"
        env:
        - name: MINIO_ROOT_USER
          value: minioadmin
        - name: MINIO_ROOT_PASSWORD
          value: minioadmin123
        ports:
        - containerPort: 9000
        - containerPort: 9001
        volumeMounts:
        - name: storage
          mountPath: /data
        resources:
          requests:
            memory: 512Mi
            cpu: 250m
          limits:
            memory: 1Gi
            cpu: 500m
      volumes:
      - name: storage
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: minio
spec:
  type: NodePort
  ports:
  - port: 9000
    targetPort: 9000
    nodePort: 30900
    name: api
  - port: 9001
    targetPort: 9001
    nodePort: 30901
    name: console
  selector:
    app: minio
EOF

# Deploy edge-gateway
echo ""
echo "🌉 Deploying Edge Gateway..."
helm upgrade --install edge-gateway ./infra/helm/edge-gateway \
  --namespace ms5-edge \
  --set image.tag=latest \
  --set nodeSelector.kubernetes\\.io/arch=arm64 \
  --set resources.requests.memory=512Mi \
  --set resources.limits.memory=1Gi \
  --set opcua.enabled=true \
  --set storeForward.enabled=true

# Setup monitoring (lightweight)
echo ""
echo "📊 Setting up lightweight monitoring..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: ms5-edge
data:
  prometheus.yml: |
    global:
      scrape_interval: 30s
      evaluation_interval: 30s
    scrape_configs:
    - job_name: 'edge-gateway'
      static_configs:
      - targets: ['edge-gateway:3019']
    - job_name: 'node-exporter'
      static_configs:
      - targets: ['localhost:9100']
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: ms5-edge
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      containers:
      - name: prometheus
        image: prom/prometheus:v2.50.1
        args:
        - '--config.file=/etc/prometheus/prometheus.yml'
        - '--storage.tsdb.path=/prometheus'
        - '--storage.tsdb.retention.time=7d'
        - '--storage.tsdb.retention.size=2GB'
        ports:
        - containerPort: 9090
        volumeMounts:
        - name: config
          mountPath: /etc/prometheus
        - name: storage
          mountPath: /prometheus
        resources:
          requests:
            memory: 256Mi
            cpu: 100m
          limits:
            memory: 512Mi
            cpu: 250m
      volumes:
      - name: config
        configMap:
          name: prometheus-config
      - name: storage
        emptyDir: {}
EOF

# Configure system optimisations for Jetson
echo ""
echo "⚡ Applying Jetson optimisations..."

# Set performance mode
sudo nvpmodel -m 0
sudo jetson_clocks

# Configure swap (important for memory-constrained edge devices)
if [ ! -f /swapfile ]; then
  echo "Creating 8GB swap file..."
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Optimise network settings
sudo sysctl -w net.core.rmem_max=134217728
sudo sysctl -w net.core.wmem_max=134217728
sudo sysctl -w net.ipv4.tcp_rmem="4096 87380 134217728"
sudo sysctl -w net.ipv4.tcp_wmem="4096 65536 134217728"
sudo sysctl -w net.core.netdev_max_backlog=5000

# Make network settings persistent
cat <<EOF | sudo tee /etc/sysctl.d/99-ms5-network.conf
net.core.rmem_max=134217728
net.core.wmem_max=134217728
net.ipv4.tcp_rmem=4096 87380 134217728
net.ipv4.tcp_wmem=4096 65536 134217728
net.core.netdev_max_backlog=5000
EOF

# Create startup script
echo ""
echo "📝 Creating startup script..."
cat <<'EOF' | sudo tee /usr/local/bin/ms5-edge-startup.sh
#!/bin/bash
# MS5 Edge Startup Script

echo "Starting MS5 Edge Services..."

# Set performance mode
nvpmodel -m 0
jetson_clocks

# Ensure K3s is running
systemctl status k3s || systemctl start k3s

# Wait for K3s
sleep 10

# Check edge gateway
kubectl get pods -n ms5-edge

echo "MS5 Edge Services Started"
EOF

sudo chmod +x /usr/local/bin/ms5-edge-startup.sh

# Create systemd service
cat <<EOF | sudo tee /etc/systemd/system/ms5-edge.service
[Unit]
Description=MS5 Edge Services
After=network.target k3s.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ms5-edge-startup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ms5-edge.service

# Print summary
echo ""
echo "=========================================="
echo "✅ Jetson Setup Complete!"
echo "=========================================="
echo ""
echo "📊 System Status:"
echo "  - K3s: $(systemctl is-active k3s)"
echo "  - Docker: $(systemctl is-active docker)"
echo "  - Performance Mode: $(sudo nvpmodel -q | grep 'NV Power Mode')"
echo ""
echo "🌐 Access Points:"
echo "  - Edge Gateway API: http://$(hostname -I | awk '{print $1}'):30019"
echo "  - MinIO Console: http://$(hostname -I | awk '{print $1}'):30901"
echo "  - Prometheus: http://$(hostname -I | awk '{print $1}'):30090"
echo ""
echo "📝 Next Steps:"
echo "  1. Configure OPC UA endpoints in edge-gateway"
echo "  2. Set up cloud synchronisation credentials"
echo "  3. Test store-and-forward functionality"
echo "  4. Monitor resource usage with 'htop' and 'iotop'"
echo ""
echo "💡 Tips:"
echo "  - Check logs: kubectl logs -n ms5-edge -l app=edge-gateway"
echo "  - Monitor GPU: nvidia-smi"
echo "  - K3s status: sudo k3s kubectl get nodes"
echo "  - System resources: tegrastats"
echo ""
echo "🔄 Reboot recommended to apply all settings"