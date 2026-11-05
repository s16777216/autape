import { useState, useEffect, useCallback } from "react"
import { api } from "../../../lib/api"
import type { TestGroup, VariableItem } from "../../../types/api"
import { toast } from "sonner"

// 遞迴處理樹狀結構，補全 parentId 並扁平化收集至一維陣列
function processGroupTree(
  nodes: TestGroup[],
  parentId: string | null = null
): { tree: TestGroup[]; flat: TestGroup[] } {
  let flat: TestGroup[] = []
  const tree = nodes.map((node) => {
    const currentParentId = node.parentId || node.parent?.id || parentId
    const mappedNode: TestGroup = {
      ...node,
      parentId: currentParentId,
    }

    flat.push(mappedNode)

    if (node.children && node.children.length > 0) {
      const result = processGroupTree(node.children, node.id)
      mappedNode.children = result.tree
      flat = flat.concat(result.flat)
    } else {
      mappedNode.children = []
    }

    return mappedNode
  })

  return { tree, flat }
}

export function useGroupData(projectId: string | undefined) {
  const [groups, setGroups] = useState<TestGroup[]>([])
  const [groupTree, setGroupTree] = useState<TestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(false)

  const loadGroups = useCallback(async (projId: string) => {
    setIsLoading(true)
    try {
      const data = await api.getGroups(projId)
      const { tree, flat } = processGroupTree(data)
      setGroupTree(tree)
      setGroups(flat)
    } catch (err) {
      console.error(err)
      toast.error("載入群組失敗")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleCreateSubgroup = async (name: string, parentId: string | null, initCookies?: unknown, initLocalStorage?: unknown, variables?: Record<string, VariableItem>) => {
    if (!name.trim() || !projectId) return null
    try {
      const newGroup = await api.createGroup(projectId, name.trim(), parentId, initCookies, initLocalStorage, variables)
      await loadGroups(projectId)
      toast.success("群組建立成功！")
      return newGroup
    } catch (err) {
      toast.error("建立群組失敗：" + err)
      return null
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await api.deleteGroup(groupId)
      if (projectId) {
        await loadGroups(projectId)
      }
      toast.success("群組刪除成功！")
      return true
    } catch (err) {
      toast.error("刪除群組失敗：" + err)
      return false
    }
  }

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) {
        if (projectId) {
          loadGroups(projectId)
        } else {
          setGroups([])
          setGroupTree([])
        }
      }
    })
    return () => {
      active = false
    }
  }, [projectId, loadGroups])

  return {
    groups,
    groupTree,
    expandedGroups,
    setExpandedGroups,
    isLoading,
    loadGroups,
    handleCreateSubgroup,
    handleDeleteGroup
  }
}
