pipeline {
    agent any

    environment {
        APP_NAME       = 'bhuvanaweb'
        IMAGE_NAME     = 'bhuvanaweb:latest'
        MINIKUBE_HOME  = '/var/lib/jenkins'
        KUBECONFIG     = '/var/lib/jenkins/.kube/config'
        CHANGE_MINIKUBE_NONE_USER = 'true'
    }

    options {
        timestamps()
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Prepare Jenkins Environment') {
            steps {
                sh '''
                    set -eux

                    mkdir -p "${MINIKUBE_HOME}/.minikube"
                    mkdir -p "${MINIKUBE_HOME}/.kube"
                    mkdir -p /tmp/minikube-locks

                    chmod 1777 /tmp/minikube-locks || true

                    echo "MINIKUBE_HOME=${MINIKUBE_HOME}"
                    echo "KUBECONFIG=${KUBECONFIG}"
                    whoami
                    pwd
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    set -eux
                    docker build -t "${IMAGE_NAME}" .
                    docker images | grep bhuvanaweb || true
                '''
            }
        }

        stage('Ensure Minikube Running') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    minikube status || true

                    if ! minikube status >/dev/null 2>&1; then
                        echo "Minikube not healthy. Recreating..."
                        minikube delete --all || true
                        rm -rf "${MINIKUBE_HOME}/.minikube" "${MINIKUBE_HOME}/.kube" || true
                        mkdir -p "${MINIKUBE_HOME}/.minikube" "${MINIKUBE_HOME}/.kube"

                        minikube start --driver=docker --kubernetes-version=v1.28.3
                    fi

                    kubectl config current-context
                    kubectl cluster-info
                    kubectl get nodes -o wide
                '''
            }
        }

        stage('Load Image Into Minikube') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    minikube image load "${IMAGE_NAME}"
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    kubectl apply -f k8s/deployment.yml
                    kubectl apply -f k8s/service.yml

                    kubectl rollout restart deployment/${APP_NAME} || true
                    kubectl rollout status deployment/${APP_NAME} --timeout=180s
                '''
            }
        }

        stage('Verify Deployment') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    kubectl get deployments -o wide
                    kubectl get pods -o wide
                    kubectl get svc -o wide
                    kubectl get endpoints ${APP_NAME}
                '''
            }
        }

        stage('Smoke Test (inside cluster)') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    kubectl run smoke-test --rm -i --restart=Never \
                      --image=curlimages/curl:8.8.0 \
                      -- curl -I http://${APP_NAME}:1001
                '''
            }
        }

        stage('NodePort Test (Jenkins machine)') {
            steps {
                sh '''
                    set -eux

                    export MINIKUBE_HOME="${MINIKUBE_HOME}"
                    export KUBECONFIG="${KUBECONFIG}"
                    export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                    NODE_IP=$(minikube ip | tail -n 1)
                    echo "Minikube IP: ${NODE_IP}"

                    curl -I --max-time 20 http://${NODE_IP}:31001 || true
                '''
            }
        }
    }

    post {
        success {
            echo 'Deployment completed successfully.'
        }

        failure {
            echo 'Pipeline failed. Debug info below:'
            sh '''
                set +e
                export MINIKUBE_HOME="${MINIKUBE_HOME}"
                export KUBECONFIG="${KUBECONFIG}"
                export CHANGE_MINIKUBE_NONE_USER="${CHANGE_MINIKUBE_NONE_USER}"

                kubectl get pods -o wide || true
                kubectl get svc -o wide || true
                kubectl describe deployment ${APP_NAME} || true
                kubectl describe svc ${APP_NAME} || true
                kubectl logs -l app=${APP_NAME} --tail=100 || true
                minikube logs --problems || true
            '''
        }

        always {
            cleanWs()
        }
    }
}
